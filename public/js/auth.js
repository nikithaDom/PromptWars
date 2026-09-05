/**
 * public/js/auth.js
 * Frontend session manager.
 * Ensures user is authenticated, updates navbar with clinician badge and logout button.
 */
(async function initAuth() {
  const isLoginPage = window.location.pathname.endsWith('login.html');

  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) throw new Error('Not authenticated');
    const data = await res.json();

    if (data.authenticated && data.user) {
      if (isLoginPage) {
        window.location.href = '/dashboard.html';
        return;
      }
      renderNavUser(data.user);
    } else if (!isLoginPage) {
      window.location.href = '/login.html';
    }
  } catch (err) {
    if (!isLoginPage) {
      window.location.href = '/login.html';
    }
  }

  function renderNavUser(user) {
    const nav = document.querySelector('nav');
    if (!nav) return;

    // Remove any previous auth container
    const existing = document.getElementById('nav-user-container');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = 'nav-user-container';
    div.className = 'nav-user-container';
    div.innerHTML = `
      <span class="user-badge" title="${user.email}">
        <span class="user-status-dot"></span>
        <strong>${user.name}</strong>
        <span class="user-role-label">(${user.role})</span>
      </span>
      <button type="button" class="btn-logout" id="btn-logout" title="Log out">Log Out</button>
    `;

    nav.appendChild(div);

    document.getElementById('btn-logout').addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } finally {
        window.location.href = '/login.html';
      }
    });
  }
})();
