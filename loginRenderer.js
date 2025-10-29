// renderer.js (login/register)
const { ipcRenderer } = require('electron');

// ---------- Elements ----------
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginBtn = document.getElementById('login-btn');

const registerName = document.getElementById('register-name');
const registerEmail = document.getElementById('register-email');
const registerPassword = document.getElementById('register-password');
const registerBtn = document.getElementById('register-btn');

// ---------- Helpers ----------
function showMessage(msg) {
  // Simple non-blocking alert
  const container = document.getElementById('message-container');
  if(container){
    container.textContent = msg;
    container.style.display = 'block';
    setTimeout(()=>{ container.style.display = 'none'; }, 4000);
  } else {
    alert(msg); // fallback
  }
}

// ---------- Login ----------
loginBtn.addEventListener('click', async () => {
  notifEl.textContent = '';
  const email = loginEmailInput.value.trim();
  const password = loginPasswordInput.value.trim();

  if(!email || !password){
    notifEl.textContent = "⚠️ Enter email and password";
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";

  try {
    console.log('Attempting login with:', email);
    const res = await window.api.loginEmail(email, password);
    console.log('Login response:', res);

    if(res.success && res.user){
      console.log('Login successful, isAdmin:', res.isAdmin);
      
      if (res.isAdmin) {
        console.log('Redirecting to admin dashboard');
        // Use direct navigation instead of IPC call
        window.location.href = 'admin.html';
      } else {
        console.log('Redirecting to user dashboard');
        window.location.href = 'index.html';
      }
    } else {
      notifEl.textContent = res.message || '❌ Login failed';
      loginEmailInput.focus();
    }
  } catch(err){
    console.error('Login error:', err);
    notifEl.textContent = '❌ Error: ' + (err.message || err);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
  }
});

// ---------- Register ----------
registerBtn.addEventListener('click', async () => {
  const name = registerName.value.trim();
  const email = registerEmail.value.trim();
  const password = registerPassword.value.trim();

  if(!name || !email || !password){
    showMessage('⚠️ Fill all fields');
    return;
  }

  try {
    const res = await ipcRenderer.invoke('register', name, email, password);
    if(res.success){
      showMessage('✅ Account created! You can now login.');
      // Clear fields
      registerName.value = '';
      registerEmail.value = '';
      registerPassword.value = '';
      loginEmail.focus();
    } else {
      showMessage(res.message || '❌ Registration failed');
    }
  } catch(e){
    console.error('Register error:', e);
    showMessage('❌ Registration error');
  }
});