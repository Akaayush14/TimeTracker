// admin-renderer.js
let currentPage = 1;
const itemsPerPage = 10;

document.addEventListener('DOMContentLoaded', function() {
    initializeAdmin();
});

async function initializeAdmin() {
    // Check if user is admin
    try {
        const userInfo = await window.api.getUserInfo();
        console.log('Admin check - userInfo:', userInfo);
        
        if (!userInfo) {
            console.log('No user info found, redirecting to login');
            window.location.href = 'login.html';
            return;
        }
        
        // More robust admin check
        const isAdmin = userInfo.is_admin === 1 || userInfo.is_admin === true;
        const isActive = userInfo.is_active === 1 || userInfo.is_active === true;
        
        console.log('Is user admin?', isAdmin);
        console.log('Is user active?', isActive);
        
        if (!isActive) {
            console.log('User account is inactive, redirecting to login');
            alert('Your account has been deactivated. Please contact administrator.');
            window.location.href = 'login.html';
            return;
        }
        
        if (!isAdmin) {
            console.log('User is not admin, redirecting to user dashboard');
            window.location.href = 'index.html';
            return;
        }
        
        console.log('User is admin, loading admin dashboard');
        loadDashboardStats();
        loadUsers();
        setupEventListeners();
        
    } catch (error) {
        console.error('Admin initialization error:', error);
        window.location.href = 'login.html';
    }
}

function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const tab = this.getAttribute('data-tab');
            switchTab(tab);
        });
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async function() {
        await window.api.logout();
        window.location.href = 'login.html';
    });

    // User form submission
    document.getElementById('user-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        await saveUser();
    });

    // Search functionality
    document.getElementById('user-search').addEventListener('input', debounce(loadUsers, 300));
}

function switchTab(tabName) {
    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-tab') === tabName) {
            link.classList.add('active');
        }
    });

    // Show active tab content
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
        if (tab.id === tabName) {
            tab.classList.add('active');
        }
    });

    // Load tab-specific data
    switch(tabName) {
        case 'dashboard':
            loadDashboardStats();
            break;
        case 'users':
            loadUsers();
            break;
        case 'reports':
            loadReportUsers();
            break;
    }
}

async function loadDashboardStats() {
    try {
        const stats = await window.api.getAdminStats();
        
        document.getElementById('total-users').textContent = stats.totalUsers || 0;
        document.getElementById('active-users').textContent = stats.activeUsers || 0;
        document.getElementById('active-sessions').textContent = stats.activeSessions || 0;
        document.getElementById('today-activities').textContent = stats.todayActivities || 0;
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

async function loadUsers(page = 1) {
    try {
        const search = document.getElementById('user-search').value;
        const users = await window.api.getUsersList(page, itemsPerPage, search);
        
        displayUsers(users.data);
        setupPagination('users-pagination', users.total, page, loadUsers);
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function displayUsers(users) {
    const tbody = document.getElementById('users-table-body');
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No users found</td></tr>';
        return;
    }

    const html = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${user.full_name}</td>
            <td>${user.email}</td>
            <td>
                <span class="${user.is_active ? 'user-status-active' : 'user-status-inactive'}">
                    ${user.is_active ? 'Active' : 'Inactive'}
                </span>
                ${user.is_admin ? '<span class="user-admin"> (Admin)</span>' : ''}
            </td>
            <td>${user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}</td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="editUser(${user.id})">Edit</button>
                <button class="btn btn-${user.is_active ? 'warning' : 'success'} btn-sm" 
                        onclick="toggleUserStatus(${user.id}, ${user.is_active})">
                    ${user.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button class="btn btn-danger btn-sm" onclick="deleteUser(${user.id})">Delete</button>
            </td>
        </tr>
    `).join('');

    tbody.innerHTML = html;
}

async function editUser(userId) {
    try {
        const user = await window.api.getUserDetails(userId);
        
        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('edit-full-name').value = user.full_name;
        document.getElementById('edit-email').value = user.email;
        document.getElementById('edit-status').value = user.is_active ? '1' : '0';
        document.getElementById('edit-is-admin').value = user.is_admin ? '1' : '0';
        
        document.getElementById('user-modal').style.display = 'block';
    } catch (error) {
        console.error('Error loading user details:', error);
        alert('Error loading user details');
    }
}

async function saveUser() {
    try {
        const userData = {
            id: document.getElementById('edit-user-id').value,
            full_name: document.getElementById('edit-full-name').value,
            email: document.getElementById('edit-email').value,
            is_active: document.getElementById('edit-status').value === '1',
            is_admin: document.getElementById('edit-is-admin').value === '1'
        };

        await window.api.updateUser(userData);
        closeModal();
        loadUsers(currentPage);
        alert('User updated successfully');
    } catch (error) {
        console.error('Error saving user:', error);
        alert('Error saving user: ' + error.message);
    }
}

async function toggleUserStatus(userId, currentStatus) {
    if (!confirm(`Are you sure you want to ${currentStatus ? 'deactivate' : 'activate'} this user?`)) {
        return;
    }

    try {
        await window.api.toggleUserStatus(userId, !currentStatus);
        loadUsers(currentPage);
        alert(`User ${currentStatus ? 'deactivated' : 'activated'} successfully`);
    } catch (error) {
        console.error('Error toggling user status:', error);
        alert('Error updating user status');
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
        return;
    }

    try {
        await window.api.deleteUser(userId);
        loadUsers(currentPage);
        alert('User deleted successfully');
    } catch (error) {
        console.error('Error deleting user:', error);
        alert('Error deleting user');
    }
}

async function loadReportUsers() {
    try {
        const users = await window.api.getUsersList(1, 1000); // Get all users for reports
        const select = document.getElementById('report-user');
        
        select.innerHTML = '<option value="all">All Users</option>';
        users.data.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = `${user.full_name} (${user.email})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading report users:', error);
    }
}

// Update exportToExcel function to generate and export directly
// Update exportToExcel function to handle attendance reports
async function exportToExcel() {
  try {
    const exportBtn = document.getElementById('export-excel-btn');
    const originalText = exportBtn.innerHTML;
    
    // Show loading state
    exportBtn.innerHTML = '<div class="loading"></div> Exporting...';
    exportBtn.disabled = true;

    const reportData = {
      userId: document.getElementById('report-user').value,
      startDate: document.getElementById('report-start-date').value,
      endDate: document.getElementById('report-end-date').value,
      reportType: document.getElementById('report-type').value
    };

    const result = await window.api.exportAdminExcel(reportData);
    
    if (result.success) {
      // Show success message with file path
      showNotification(`Excel exported successfully: ${result.filePath}`, 'success');
      
      // Optional: Open file location
      if (confirm('Excel file exported successfully! Would you like to open the file location?')) {
        // This would require adding a new IPC handler to show item in folder
        // You can implement this if needed
      }
    } else {
      showNotification('Error exporting to Excel: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    showNotification('Error exporting to Excel: ' + error.message, 'error');
  } finally {
    // Restore button state
    const exportBtn = document.getElementById('export-excel-btn');
    exportBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <path d="M16 13H8"></path>
        <path d="M16 17H8"></path>
        <path d="M10 9H8"></path>
      </svg>
      Export to Excel
    `;
    exportBtn.disabled = false;
  }
}

// Add function to generate attendance report preview (optional)
async function generateAttendanceReport() {
  try {
    const reportData = {
      userId: document.getElementById('report-user').value,
      startDate: document.getElementById('report-start-date').value,
      endDate: document.getElementById('report-end-date').value,
      reportType: 'attendance'
    };

    const results = await window.api.generateReport(reportData);
    displayAttendanceResults(results);
  } catch (error) {
    console.error('Error generating attendance report:', error);
  }
}

function displayAttendanceResults(results) {
  const container = document.getElementById('report-content');
  const reportResults = document.getElementById('report-results');
  
  if (!results || results.length === 0) {
    container.innerHTML = '<p>No attendance data found for the selected period.</p>';
    reportResults.style.display = 'block';
    return;
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th>User</th>
          <th>Date</th>
          <th>First Activity</th>
          <th>Last Activity</th>
          <th>Total Time</th>
          <th>Active Time</th>
          <th>Productivity %</th>
        </tr>
      </thead>
      <tbody>
  `;

  results.forEach(record => {
    html += `
      <tr>
        <td>${record.user_name}</td>
        <td>${record.date}</td>
        <td>${record.first_activity || 'N/A'}</td>
        <td>${record.last_activity || 'N/A'}</td>
        <td>${record.total_time || '0h 0m'}</td>
        <td>${record.active_time || '0h 0m'}</td>
        <td>${record.productivity_percentage || '0%'}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
  reportResults.style.display = 'block';
}

function closeModal() {
    document.getElementById('user-modal').style.display = 'none';
}

function setupPagination(elementId, totalItems, currentPage, callback) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const pagination = document.getElementById(elementId);
    
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let html = '';
    
    // Previous button
    if (currentPage > 1) {
        html += `<span class="page-item" onclick="${callback.name}(${currentPage - 1})">Previous</span>`;
    }

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPage) {
            html += `<span class="page-item active">${i}</span>`;
        } else {
            html += `<span class="page-item" onclick="${callback.name}(${i})">${i}</span>`;
        }
    }

    // Next button
    if (currentPage < totalPages) {
        html += `<span class="page-item" onclick="${callback.name}(${currentPage + 1})">Next</span>`;
    }

    pagination.innerHTML = html;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 400px;
    `;
    
    // Set background color based on type
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    
    notification.style.backgroundColor = colors[type] || colors.info;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('user-modal');
    if (event.target === modal) {
        closeModal();
    }
}