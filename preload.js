// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Existing methods...
  // Add these new methods:
  loginEmail: (email, password) => ipcRenderer.invoke('login-email', email, password),
  register: (fullName, email, password) => ipcRenderer.invoke('register', fullName, email, password),
  loadDashboard: () => ipcRenderer.invoke('load-dashboard'),
  
  logout: () => ipcRenderer.invoke('logout'),
  getTrackingStatus: () => ipcRenderer.invoke('get-tracking-status'),
  getUserInfo: () => ipcRenderer.invoke('get-user-info'),

  // Idle / activity
  getIdleSeconds: () => ipcRenderer.invoke('get-idle-seconds'),
  logIdle: () => ipcRenderer.invoke('log-idle'),
  idleBreakStart: () => ipcRenderer.invoke('idle-break-start'),
  idleBreakStop: () => ipcRenderer.invoke('idle-break-stop'),

  // Capture screenshot
  captureScreenshot: () => ipcRenderer.invoke('save-screenshot-and-log', {}),
  
  // Screenshot captured listener
  onScreenshotCaptured: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('screenshot-captured', (_e, path) => {
      if (path) callback(path); // Only call callback if path exists
    });
  },

  // Breaks
  startBreak: () => ipcRenderer.invoke('start-break'),
  stopBreak: () => ipcRenderer.invoke('stop-break'),

  // Screenshots / file picker
  saveScreenshotAndLog: (dataURL) => {
    if (!dataURL) return Promise.reject('No screenshot data provided'); // Prevent empty screenshots
    return ipcRenderer.invoke('save-screenshot-and-log', { dataURL });
  },
  pickFolder: () => ipcRenderer.invoke('pick-folder'),

  // Admin methods
  getAdminStats: () => ipcRenderer.invoke('get-admin-stats'),
  getUsersList: (page, limit, search) => ipcRenderer.invoke('get-users-list', page, limit, search),
  getUserDetails: (userId) => ipcRenderer.invoke('get-user-details', userId),
  updateUser: (userData) => ipcRenderer.invoke('update-user', userData),
  toggleUserStatus: (userId, activate) => ipcRenderer.invoke('toggle-user-status', userId, activate),
  deleteUser: (userId) => ipcRenderer.invoke('delete-user', userId),
  getUserActivities: (userId, date, page, limit) => ipcRenderer.invoke('get-user-activities', userId, date, page, limit),
  getRecentActivities: (limit) => ipcRenderer.invoke('get-recent-activities', limit),
  generateReport: (reportData) => ipcRenderer.invoke('generate-report', reportData),
  exportAdminExcel: (reportData) => ipcRenderer.invoke('export-admin-excel', reportData),

  // Add this method:
  loadAdminDashboard: () => ipcRenderer.invoke('load-admin-dashboard'),

  // Subscribe to idle state changes emitted by main process.
  // cb will be called with a single argument: the data object sent from main.
  // Example usage in renderer:
  //   window.api.onIdleState(data => { console.log(data); });
  onIdleState: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('idle-state-changed', (_event, data) => {
      try {
        cb(data);
      } catch (err) {
        console.error('Error in onIdleState callback:', err);
      }
    });
  },

  // Export activity Excel
  exportActivityExcel: () => ipcRenderer.invoke('export-activity-excel')
});