// main.js
const { app, BrowserWindow, ipcMain, dialog, powerMonitor } = require('electron');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra');
const dayjs = require('dayjs');
const mysql = require('mysql2/promise');
const screenshot = require('screenshot-desktop');

let autoScreenshotInterval = null;
const AUTO_SCREENSHOT_MS = 1 * 60 * 1000; // 2 minutes
let win;
let db;
let currentUserId = null;
let currentSessionId = null;
let trackingActive = false;

// Break state
let manualBreakActive = false;
let idleBreakActive = false;
let manualBreakStartTs = null;
let idleBreakStartTs = null;

const IDLE_THRESHOLD_SECONDS = 10;
let idleWatcherInterval = null;

// Folder where screenshots will be stored
const SCREENSHOT_BASE_FOLDER = 'C:\\Users\\Aayush Kharel\\Pictures\\TimeTrackerScreenshots';

// Create window
async function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 680,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false // Don't show immediately
  });

  await win.loadFile('login.html');
  
  // Show window only after content is loaded
  win.once('ready-to-show', () => {
    win.show();
  });
}

// MySQL connection
async function connectDB() {
  db = await mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '@Akfalcon401040',
    database: 'time_tracker',
    waitForConnections: true,
    connectionLimit: 10,
  });
}

// App ready
app.whenReady().then(async () => {
  await connectDB();
  await createWindow();
  startIdleWatcher();
  startAutoScreenshotLoop();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

/* ============ Idle watcher ============ */
function startIdleWatcher() {
  if (idleWatcherInterval) return;

  idleWatcherInterval = setInterval(async () => {
    try {
      if (!currentUserId || !currentSessionId || !trackingActive) {
        if (idleBreakActive) {
          const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
          await db.query(
            'INSERT INTO activity (user_id, session_id, ts, is_idle, is_break, screenshot_path, note) VALUES (?, ?, ?, ?, ?, NULL, ?)',
            [currentUserId, currentSessionId, now, 0, 1, 'idle_break_stop']
          );
          idleBreakActive = false;
          idleBreakStartTs = null;
          if (win && win.webContents) {
            win.webContents.send('idle-state-changed', { state: 'active', ts: now });
          }
        }
        return;
      }

      const idleSec = powerMonitor.getSystemIdleTime();

      // User becomes idle
      if (idleSec >= IDLE_THRESHOLD_SECONDS && !idleBreakActive) {
        idleBreakActive = true;
        idleBreakStartTs = dayjs().format('YYYY-MM-DD HH:mm:ss');

        // Log idle start in DB
        await db.query(
            'INSERT INTO activity (user_id, session_id, ts, is_idle, is_break, screenshot_path, note) VALUES (?, ?, ?, ?, ?, NULL, ?)',
            [currentUserId, currentSessionId, idleBreakStartTs, 1, 1, 'idle_break_start']
        );

        if (win && win.webContents) {
            win.webContents.send('idle-state-changed', { state: 'idle', ts: idleBreakStartTs, idleSec });
        }

        // Take screenshot immediately when idle starts
        if (!manualBreakActive){
        }
      }

      // User returns from idle
      else if (idleSec < IDLE_THRESHOLD_SECONDS && idleBreakActive) {
        const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
        await db.query(
            'INSERT INTO activity (user_id, session_id, ts, is_idle, is_break, screenshot_path, note) VALUES (?, ?, ?, ?, ?, NULL, ?)',
            [currentUserId, currentSessionId, now, 0, 1, 'idle_break_stop']
        );
        const startedAt = idleBreakStartTs;
        idleBreakActive = false;
        idleBreakStartTs = null;

        if (win && win.webContents) {
            win.webContents.send('idle-state-changed', { state: 'active', ts: now, startedAt, idleSec });
        }
      }
    } catch (err) {
        console.error('Idle watcher error:', err);
    }
  }, 1000);
}

/* ============ Auto Screenshot ============ */
function startAutoScreenshotLoop() {
  if (autoScreenshotInterval) return;

  const runCapture = async () => {
    try {
      if (!trackingActive || !currentUserId || !currentSessionId) return;
      if (manualBreakActive) return;

      const buf = await screenshot({ format: 'png' });

      const baseDir = path.join(
          SCREENSHOT_BASE_FOLDER,
          dayjs().format('YYYY-MM-DD'),
          String(currentSessionId)
      );
      fsExtra.mkdirpSync(baseDir);

      const filename = `${dayjs().format('HH-mm-ss')}.png`;
      const fullPath = path.join(baseDir, filename);
      fs.writeFileSync(fullPath, buf);

      const ts = dayjs().format('YYYY-MM-DD HH:mm:ss');
      await db.query(
          'INSERT INTO activity (user_id, session_id, ts, is_idle, is_break, screenshot_path, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [currentUserId, currentSessionId, ts, 0, 0, fullPath, 'auto_screenshot']
      );

      // 🔹 Step 2: Send screenshot path to renderer
      if (win && win.webContents) win.webContents.send('screenshot-captured', `file://${fullPath}`);
    } catch (err) {
        console.error('Error in auto screenshot runCapture:', err);
    }
  };

  runCapture().catch(console.error);
  autoScreenshotInterval = setInterval(() => {
    runCapture().catch(console.error);
  }, AUTO_SCREENSHOT_MS);
}

function stopAutoScreenshotLoop() {
  if (autoScreenshotInterval) {
    clearInterval(autoScreenshotInterval);
    autoScreenshotInterval = null;
  }
}

// Helpers
function decodeBase64Image(dataURL) {
  const matches = dataURL.match(/^data:image\/png;base64,(.+)$/);
  if (!matches || matches.length !== 2) return null;
  return Buffer.from(matches[1], 'base64');
}

// ---------- Excel export ----------
async function exportActivityExcel() {
  if (!currentUserId || !currentSessionId) {
    return { success: false, message: 'No active session' };
  }

  try {
    const [users] = await db.query('SELECT full_name FROM users WHERE id = ?', [currentUserId]);
    const username = users.length ? users[0].full_name.replace(/\s+/g, '_') : `user_${currentUserId}`;

    const [rows] = await db.query(
        `SELECT ts, is_idle, is_break, screenshot_path, note 
         FROM activity 
         WHERE user_id = ? AND session_id = ? 
         ORDER BY ts ASC`,
        [currentUserId, currentSessionId]
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Activity Log');

    worksheet.columns = [
      { header: 'Timestamp', key: 'ts', width: 25 },
      { header: 'Idle', key: 'is_idle', width: 10 },
      { header: 'Break', key: 'is_break', width: 10 },
      { header: 'Screenshot Path', key: 'screenshot_path', width: 60 },
      { header: 'Note', key: 'note', width: 30 }
    ];

    worksheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FF1F2937' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        right: { style: 'thin', color: { argb: 'FF9CA3AF' } }
      };
    });

    rows.forEach((row, index) => {
      const r = worksheet.addRow({
        ts: dayjs(row.ts).format('YYYY-MM-DD HH:mm:ss'),
        is_idle: row.is_idle ? 'Yes' : 'No',
        is_break: row.is_break ? 'Yes' : 'No',
        screenshot_path: row.screenshot_path || '',
        note: row.note || ''
      });

      if (index % 2 === 0) {
        r.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; });
      }

      r.eachCell(cell => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
      });
    });

    worksheet.autoFilter = { from: 'A1', to: 'E1' };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    const filePath = path.join(
        app.getPath('documents'),
        `ActivityLog_${username}_${currentSessionId}.xlsx`
    );
    await workbook.xlsx.writeFile(filePath);

    return { success: true, filePath };
  } catch (err) {
    console.error('Excel export error:', err);
    return { success: false, message: err.message };
  }
}

// ============ ADMIN IPC HANDLERS ============
// Admin statistics
ipcMain.handle('get-admin-stats', async () => {
  try {
    const [[{totalUsers}]] = await db.query('SELECT COUNT(*) as totalUsers FROM users');
    const [[{activeUsers}]] = await db.query('SELECT COUNT(*) as activeUsers FROM users WHERE is_active = 1');
    const [[{activeSessions}]] = await db.query('SELECT COUNT(*) as activeSessions FROM sessions WHERE logout_time IS NULL');
    const [[{todayActivities}]] = await db.query('SELECT COUNT(*) as todayActivities FROM activity WHERE DATE(ts) = CURDATE()');
    
    return { totalUsers, activeUsers, activeSessions, todayActivities };
  } catch (error) {
    console.error('Error getting admin stats:', error);
    return { totalUsers: 0, activeUsers: 0, activeSessions: 0, todayActivities: 0 };
  }
});

// Get users list with pagination
ipcMain.handle('get-users-list', async (_evt, page = 1, limit = 10, search = '') => {
  try {
    const offset = (page - 1) * limit;
    let query = 'SELECT id, full_name, email, is_active, is_admin, last_login, created_at FROM users';
    let countQuery = 'SELECT COUNT(*) as total FROM users';
    
    const params = [];
    const countParams = [];
    
    if (search) {
      const searchCondition = ' WHERE full_name LIKE ? OR email LIKE ?';
      query += searchCondition;
      countQuery += searchCondition;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const [users] = await db.query(query, params);
    const [[{total}]] = await db.query(countQuery, countParams);
    
    return { data: users, total, page, limit };
  } catch (error) {
    console.error('Error getting users list:', error);
    return { data: [], total: 0, page, limit };
  }
});

// Get user details
ipcMain.handle('get-user-details', async (_evt, userId) => {
  try {
    const [users] = await db.query(
      'SELECT id, full_name, email, is_active, is_admin, created_at, last_login FROM users WHERE id = ?',
      [userId]
    );
    return users.length ? users[0] : null;
  } catch (error) {
    console.error('Error getting user details:', error);
    throw error;
  }
});

// Update user
ipcMain.handle('update-user', async (_evt, userData) => {
  try {
    await db.query(
      'UPDATE users SET full_name = ?, email = ?, is_active = ?, is_admin = ? WHERE id = ?',
      [userData.full_name, userData.email, userData.is_active, userData.is_admin, userData.id]
    );
    return { success: true };
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
});

// Toggle user status
ipcMain.handle('toggle-user-status', async (_evt, userId, activate) => {
  try {
    await db.query(
      'UPDATE users SET is_active = ?, deactivated_at = ? WHERE id = ?',
      [activate, activate ? null : new Date(), userId]
    );
    return { success: true };
  } catch (error) {
    console.error('Error toggling user status:', error);
    throw error;
  }
});

// Delete user
ipcMain.handle('delete-user', async (_evt, userId) => {
  try {
    await db.query('DELETE FROM users WHERE id = ?', [userId]);
    return { success: true };
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
});

// Get user activities
ipcMain.handle('get-user-activities', async (_evt, userId, date, page = 1, limit = 10) => {
  try {
    const offset = (page - 1) * limit;
    let query = `
      SELECT a.*, u.full_name as user_name 
      FROM activity a 
      JOIN users u ON a.user_id = u.id 
      WHERE 1=1
    `;
    
    const params = [];
    const countParams = [];
    
    if (userId && userId !== 'all') {
      query += ' AND a.user_id = ?';
      params.push(userId);
      countParams.push(userId);
    }
    
    if (date) {
      query += ' AND DATE(a.ts) = ?';
      params.push(date);
      countParams.push(date);
    }
    
    const countQuery = `SELECT COUNT(*) as total FROM activity a WHERE 1=1${userId && userId !== 'all' ? ' AND a.user_id = ?' : ''}${date ? ' AND DATE(a.ts) = ?' : ''}`;
    
    query += ' ORDER BY a.ts DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const [activities] = await db.query(query, params);
    const [[{total}]] = await db.query(countQuery, countParams);
    
    return { data: activities, total, page, limit };
  } catch (error) {
    console.error('Error getting user activities:', error);
    return { data: [], total: 0, page, limit };
  }
});

// Generate report
ipcMain.handle('generate-report', async (_evt, reportData) => {
  try {
    // Implement report generation logic based on reportData
    // This is a simplified example
    let query = `
      SELECT u.full_name, u.email, COUNT(a.id) as activity_count,
             SUM(CASE WHEN a.is_break = 1 THEN 1 ELSE 0 END) as break_count,
             MIN(a.ts) as first_activity, MAX(a.ts) as last_activity
      FROM users u 
      LEFT JOIN activity a ON u.id = a.user_id 
      WHERE 1=1
    `;
    
    const params = [];
    
    if (reportData.userId && reportData.userId !== 'all') {
      query += ' AND u.id = ?';
      params.push(reportData.userId);
    }
    
    if (reportData.startDate) {
      query += ' AND DATE(a.ts) >= ?';
      params.push(reportData.startDate);
    }
    
    if (reportData.endDate) {
      query += ' AND DATE(a.ts) <= ?';
      params.push(reportData.endDate);
    }
    
    query += ' GROUP BY u.id, u.full_name, u.email';
    
    const [results] = await db.query(query, params);
    return results;
  } catch (error) {
    console.error('Error generating report:', error);
    throw error;
  }
});

// Enhanced generateReportData function for attendance reports
async function generateReportData(reportData) {
  let query = '';
  const params = [];
  
  switch(reportData.reportType) {
    case 'activity':
      query = `
        SELECT u.full_name, u.email, a.ts as timestamp,
               CASE 
                 WHEN a.is_break = 1 AND a.is_idle = 1 THEN 'Idle Break'
                 WHEN a.is_break = 1 THEN 'Manual Break'
                 WHEN a.is_idle = 1 THEN 'Idle'
                 ELSE 'Work'
               END as activity_type,
               a.note, a.screenshot_path
        FROM users u 
        JOIN activity a ON u.id = a.user_id 
        WHERE 1=1
      `;
      
      if (reportData.userId && reportData.userId !== 'all') {
        query += ' AND u.id = ?';
        params.push(reportData.userId);
      }
      
      if (reportData.startDate) {
        query += ' AND DATE(a.ts) >= ?';
        params.push(reportData.startDate);
      }
      
      if (reportData.endDate) {
        query += ' AND DATE(a.ts) <= ?';
        params.push(reportData.endDate);
      }
      
      query += ' ORDER BY a.ts DESC';
      break;
      
    case 'attendance':
      query = `
        SELECT 
          u.full_name as username,
          DATE(a.ts) as date,
          MIN(a.ts) as login_time,
          MAX(a.ts) as logout_time,
          SUM(CASE WHEN a.is_idle = 1 AND a.is_break = 1 THEN 1 ELSE 0 END) as idle_break_count,
          SUM(CASE WHEN a.is_break = 1 AND a.is_idle = 0 THEN 1 ELSE 0 END) as manual_break_count,
          SUM(CASE WHEN a.note LIKE '%request%break%' THEN 1 ELSE 0 END) as request_break_count,
          TIMESTAMPDIFF(SECOND, MIN(a.ts), MAX(a.ts)) as total_seconds,
          7 * 3600 as working_ideal_limit,
          CASE 
            WHEN TIMESTAMPDIFF(SECOND, MIN(a.ts), MAX(a.ts)) > 7 * 3600 
            THEN TIMESTAMPDIFF(SECOND, MIN(a.ts), MAX(a.ts)) - 7 * 3600 
            ELSE 0 
          END as extra_seconds,
          CASE 
            WHEN TIMESTAMPDIFF(SECOND, MIN(a.ts), MAX(a.ts)) < 7 * 3600 
            THEN 7 * 3600 - TIMESTAMPDIFF(SECOND, MIN(a.ts), MAX(a.ts)) 
            ELSE 0 
          END as deduct_seconds
        FROM users u 
        LEFT JOIN activity a ON u.id = a.user_id 
        WHERE 1=1
      `;
      
      if (reportData.userId && reportData.userId !== 'all') {
        query += ' AND u.id = ?';
        params.push(reportData.userId);
      }
      
      if (reportData.startDate) {
        query += ' AND DATE(a.ts) >= ?';
        params.push(reportData.startDate);
      } else {
        query += ' AND DATE(a.ts) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
      }
      
      if (reportData.endDate) {
        query += ' AND DATE(a.ts) <= ?';
        params.push(reportData.endDate);
      }
      
      query += ' GROUP BY u.full_name, DATE(a.ts) ORDER BY u.full_name, DATE(a.ts) DESC';
      break;
      
    default:
      return [];
  }
  
  try {
    console.log('Executing query:', query);
    console.log('With params:', params);
    
    const [results] = await db.query(query, params);
    console.log('Query results count:', results.length);
    
    return results;
  } catch (error) {
    console.error('Error generating report data:', error);
    return [];
  }
}

// Update the export-admin-excel handler to include attendance report formatting
ipcMain.handle('export-admin-excel', async (_evt, reportData) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const { app } = require('electron');
    
    // Get report data
    const reportResults = await generateReportData(reportData);
    
    if (!reportResults || reportResults.length === 0) {
      return { success: false, message: 'No data available for export' };
    }

    // Create workbook using ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(
      reportData.reportType === 'attendance' ? 'Attendance Report' : 'Activity Log'
    );

    // Define columns based on report type  
    let columns = [];

    if (reportData.reportType === 'activity') {
      columns = [
        { header: 'User Name', key: 'full_name', width: 25 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Timestamp', key: 'timestamp', width: 25 },
        { header: 'Activity Type', key: 'activity_type', width: 15 },
        { header: 'Note', key: 'note', width: 30 },
        { header: 'Screenshot Path', key: 'screenshot_path', width: 50 }
      ];
    } else { // attendance report
      columns = [
        { header: 'Username', key: 'username', width: 20 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Login', key: 'login_time', width: 20 },
        { header: 'Logout', key: 'logout_time', width: 20 },
        { header: 'Idle Break', key: 'idle_break_count', width: 12 },
        { header: 'Manual Break', key: 'manual_break_count', width: 12 },
        { header: 'Request Break', key: 'request_break_count', width: 12 },
        { header: 'Working Ideal Limit (7h)', key: 'working_ideal_limit', width: 18 },
        { header: 'Deduct (seconds)', key: 'deduct_seconds', width: 15 },
        { header: 'Extra Hours (seconds)', key: 'extra_seconds', width: 18 },
        { header: 'Total Hours', key: 'total_hours', width: 12 }
      ];
    }

    worksheet.columns = columns;

    // Style header row
    worksheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FF1F2937' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        right: { style: 'thin', color: { argb: 'FF9CA3AF' } }
      };
    });
    
    // Add data rows with alternating colors and proper formatting
    reportResults.forEach((row, index) => {
      // Format the data for attendance report
      const formattedRow = reportData.reportType === 'attendance' ? {
        username: row.username || '-',
        date: row.date ? dayjs(row.date).format('YYYY-MM-DD') : '-',
        login_time: row.login_time ? dayjs(row.login_time).format('YYYY-MM-DD HH:mm:ss') : '-',
        logout_time: row.logout_time ? dayjs(row.logout_time).format('YYYY-MM-DD HH:mm:ss') : '-',
        idle_break_count: row.idle_break_count || 0,
        manual_break_count: row.manual_break_count || 0,
        request_break_count: row.request_break_count || 0,
        working_ideal_limit: '7:00:00',
        deduct_seconds: row.deduct_seconds ? Math.floor(row.deduct_seconds / 3600) + ':' + 
                        Math.floor((row.deduct_seconds % 3600) / 60).toString().padStart(2, '0') + ':' + 
                        (row.deduct_seconds % 60).toString().padStart(2, '0') : '0:00:00',
        extra_seconds: row.extra_seconds ? Math.floor(row.extra_seconds / 3600) + ':' + 
                      Math.floor((row.extra_seconds % 3600) / 60).toString().padStart(2, '0') + ':' + 
                      (row.extra_seconds % 60).toString().padStart(2, '0') : '0:00:00',
        total_hours: row.total_seconds ? Math.floor(row.total_seconds / 3600) + ':' + 
                    Math.floor((row.total_seconds % 3600) / 60).toString().padStart(2, '0') + ':' + 
                    (row.total_seconds % 60).toString().padStart(2, '0') : '0:00:00'
      } : row;

      const excelRow = worksheet.addRow(formattedRow);
      
      // Color code based on attendance status
      if (reportData.reportType === 'attendance') {
        const totalHoursCell = excelRow.getCell('total_hours');
        const totalSeconds = row.total_seconds || 0;
        
        if (totalSeconds >= 7 * 3600) {
          totalHoursCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } };
          totalHoursCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        } else if (totalSeconds >= 6 * 3600) {
          totalHoursCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } };
          totalHoursCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        } else {
          totalHoursCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
          totalHoursCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        }
      }
      
      // Alternate row coloring
      if (index % 2 === 0) {
        excelRow.eachCell(cell => { 
          if (reportData.reportType !== 'attendance' || 
              !['total_hours', 'deduct_seconds', 'extra_seconds'].includes(cell._column._key)) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
          }
        });
      }

      excelRow.eachCell(cell => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
      });
    });

    // Add filters and freeze header row
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Generate filename with timestamp
    const timestamp = dayjs().format('YYYY-MM-DD_HH-mm-ss');
    const reportTypeName = reportData.reportType === 'attendance' ? 'Attendance' : 'ActivityLog';
    const filename = `TimeTracker_${reportTypeName}_Report_${timestamp}.xlsx`;
    
    // Save to user's Documents folder
    const documentsDir = app.getPath('documents');
    const filePath = path.join(documentsDir, filename);

    // Ensure Documents directory exists
    if (!fs.existsSync(documentsDir)) {
      fs.mkdirSync(documentsDir, { recursive: true });
    }
    
    // Write file
    await workbook.xlsx.writeFile(filePath);

    return { success: true, filePath };
  } catch (error) {
    console.error('Error exporting admin Excel:', error);
    return { success: false, message: error.message };
  }
});

// ---------- Email-based login ----------
ipcMain.handle('login-email', async (_evt, email, password) => {
  try {
    console.log('Login attempt for email:', email);
    
    // Check if user exists with the given email and password
    const [rows] = await db.query('SELECT id, full_name, password, is_admin, is_active FROM users WHERE email = ?', [email]);
    console.log('Database query result:', rows);
    
    if (rows.length === 0) {
      console.log('User not found');
      return { success: false, message: 'Invalid email or password' };
    }
    
    const user = rows[0];
    console.log('Found user:', user);
    
    // Check if user is active
    if (!user.is_active) {
      console.log('User account is inactive');
      return { success: false, message: 'Account is deactivated. Please contact administrator.' };
    }
    
    // Compare passwords (plain text for now)
    if (user.password !== password) {
      console.log('Password mismatch');
      return { success: false, message: 'Invalid email or password' };
    }

    const userId = user.id;
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    
    // Update last login time
    await db.query('UPDATE users SET last_login = ? WHERE id = ?', [now, userId]);
    
    const [res] = await db.query('INSERT INTO sessions (user_id, login_time) VALUES (?, ?)', [userId, now]);

    currentUserId = userId;
    currentSessionId = res.insertId;
    trackingActive = true;
    manualBreakActive = false;
    idleBreakActive = false;
    manualBreakStartTs = null;
    idleBreakStartTs = null;

    // FIX: Proper boolean conversion for admin status
    const isAdmin = Boolean(user.is_admin); // Convert to proper boolean
    
    console.log('User is_admin value:', user.is_admin);
    console.log('Converted isAdmin boolean:', isAdmin);
    
    // Prepare user object
    const userObj = {
      id: user.id, 
      full_name: user.full_name, 
      is_admin: isAdmin,
      is_active: user.is_active
    };
    
    console.log('User object for response:', userObj);
    
    // FIX: Return consistent response structure
    return { 
      success: true, 
      isAdmin: isAdmin, 
      user: userObj, 
      sessionId: currentSessionId, 
      login_time: now 
    };
  } catch (err) {
    console.error('Login error:', err);
    return { success: false, message: 'Login failed: ' + err.message };
  }
});

// ---------- Registration ----------
ipcMain.handle('register', async (_evt, fullName, email, password) => {
  try {
    // Check if user already exists
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) return { success: false, message: 'User already exists' };

    // Create new user (store password in plain text for now - NOT recommended for production)
    const [res] = await db.query('INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)', 
      [fullName, email, password]);
    
    return { success: true, userId: res.insertId };
  } catch (err) {
    console.error('Registration error:', err);
    return { success: false, message: 'Registration failed' };
  }
});

// ---------- Load dashboard ----------
ipcMain.handle('load-dashboard', async () => {
  if (win) {
    await win.loadFile('index.html'); // This loads the user dashboard
  }
  return { success: true };
});

// ---------- Load admin dashboard ----------
ipcMain.handle('load-admin-dashboard', async () => {
  if (win) {
    await win.loadFile('admin.html'); // This loads the admin dashboard
  }
  return { success: true };
});
// ---------- Get user info ----------
ipcMain.handle('get-user-info', async () => {
  if (!currentUserId) return null;
  const [rows] = await db.query('SELECT id, full_name, is_admin, is_active FROM users WHERE id = ?', [currentUserId]);
  return rows.length ? rows[0] : null;
});

// ---------- Original numeric ID login (keep for compatibility) ----------
ipcMain.handle('login', async (_evt, userId) => {
  if (!userId) throw new Error('User ID required');
  const [rows] = await db.query('SELECT id, full_name FROM users WHERE id = ?', [userId]);
  if (rows.length === 0) throw new Error('User not found');

  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const [res] = await db.query('INSERT INTO sessions (user_id, login_time) VALUES (?, ?)', [userId, now]);

  currentUserId = userId;
  currentSessionId = res.insertId;
  trackingActive = true;
  manualBreakActive = false;
  idleBreakActive = false;
  manualBreakStartTs = null;
  idleBreakStartTs = null;

  return { sessionId: currentSessionId, login_time: now, user: rows[0] };
});

// Test function to check admin user
async function testAdminUser() {
    try {
        const [rows] = await db.query('SELECT id, full_name, email, is_admin, is_active FROM users WHERE email = ?', ['admin@timetracker.com']);
        console.log('Admin user check:', rows);
        if (rows.length > 0) {
            console.log('Admin user found:', rows[0]);
            console.log('is_admin value:', rows[0].is_admin, 'type:', typeof rows[0].is_admin);
        }
    } catch (err) {
        console.error('Error checking admin user:', err);
    }
}

// Call this after DB connection
app.whenReady().then(async () => {
    await connectDB();
    await testAdminUser(); // Add this line
    await createWindow();
    // ... rest of your code
});

// ---------- Other existing IPC handlers ----------
ipcMain.handle('export-activity-excel', exportActivityExcel);
ipcMain.handle('get-idle-seconds', async () => powerMonitor.getSystemIdleTime());

// In main.js, find the logout IPC handler and modify it:

ipcMain.handle('logout', async () => {
  if (!currentUserId || !currentSessionId) return { message: 'Not logged in' };
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await db.query('UPDATE sessions SET logout_time = ? WHERE id = ?', [now, currentSessionId]);

  // Check if user is admin before exporting activity log
  try {
    const [userRows] = await db.query('SELECT is_admin FROM users WHERE id = ?', [currentUserId]);
    const isAdmin = userRows.length > 0 && userRows[0].is_admin;
    
    // Only export activity log for non-admin users
    if (!isAdmin) {
      await exportActivityExcel();
    }
  } catch (err) { 
    console.error('Error checking admin status during logout:', err); 
  }

  const sessionId = currentSessionId;
  currentUserId = null;
  currentSessionId = null;
  trackingActive = false;
  manualBreakActive = false;
  idleBreakActive = false;
  manualBreakStartTs = null;
  idleBreakStartTs = null;

  return { sessionId, logout_time: now };
});
ipcMain.handle('get-tracking-status', async () => ({
  trackingActive, currentUserId, currentSessionId, manualBreakActive, idleBreakActive
}));

// Log idle tick
ipcMain.handle('log-idle', async () => {
  if (!currentUserId || !currentSessionId) return { logged: false };
  const ts = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await db.query('INSERT INTO activity (user_id, session_id, ts, is_idle, is_break, screenshot_path) VALUES (?, ?, ?, ?, ?, NULL)', [currentUserId, currentSessionId, ts, 1, 0]);
  return { logged: true, ts };
});

// Manual break start/stop
ipcMain.handle('start-break', async () => {
  if (!currentUserId || !currentSessionId) return { started: false, reason: 'Not logged in' };
  if (manualBreakActive) return { started: false, reason: 'Break already active' };

  manualBreakActive = true;
  manualBreakStartTs = dayjs().format('YYYY-MM-DD HH:mm:ss');

  await db.query('INSERT INTO activity (user_id, session_id, ts, is_idle, is_break, screenshot_path, note) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    [currentUserId, currentSessionId, manualBreakStartTs, 0, 1, 'manual_break_start']
  );

  return { started: true, ts: manualBreakStartTs };
});

ipcMain.handle('stop-break', async () => {
  if (!currentUserId || !currentSessionId) return { stopped: false, reason: 'Not logged in' };
  if (!manualBreakActive) return { stopped: false, reason: 'No manual break active' };

  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await db.query('INSERT INTO activity (user_id, session_id, ts, is_idle, is_break, screenshot_path, note) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    [currentUserId, currentSessionId, now, 0, 1, 'manual_break_stop']
  );

  manualBreakActive = false;
  const startedAt = manualBreakStartTs;
  manualBreakStartTs = null;

  return { stopped: true, ts: now, startedAt };
});

// Idle-break start/stop
ipcMain.handle('idle-break-start', async () => {
  if (!currentUserId || !currentSessionId) return { started: false, reason: 'Not logged in' };
  if (idleBreakActive) return { started: false, reason: 'Idle break already active' };

  idleBreakActive = true;
  idleBreakStartTs = dayjs().format('YYYY-MM-DD HH:mm:ss');

  await db.query('INSERT INTO activity (user_id, session_id, ts, is_idle, is_break, screenshot_path, note) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    [currentUserId, currentSessionId, idleBreakStartTs, 1, 1, 'idle_break_start']
  );

  return { started: true, ts: idleBreakStartTs };
});

ipcMain.handle('idle-break-stop', async () => {
  if (!currentUserId || !currentSessionId) return { stopped: false, reason: 'Not logged in' };
  if (!idleBreakActive) return { stopped: false, reason: 'No idle break active' };

  
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await db.query('INSERT INTO activity (user_id, session_id, ts, is_idle, is_break, screenshot_path, note) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    [currentUserId, currentSessionId, now, 0, 1, 'idle_break_stop']
  );

  idleBreakActive = false;
  const startedAt = idleBreakStartTs;
  idleBreakStartTs = null;

  return { stopped: true, ts: now, startedAt };
});

// Optional folder picker
ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});