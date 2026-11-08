

const showAlert = (message, type) => {
    const alertBox = document.getElementById('alertBox');
    if(alertBox) {
        alertBox.textContent = message;
        alertBox.className = `alert alert-${type}`;
        alertBox.style.display = 'block';
        setTimeout(() => alertBox.style.display = 'none', 5000);
    }
};

fetch('/api/profile')
    .then(r => r.json())
    .then(user => {
        if (user.access_level_id === 1) {
            const adminLink = document.getElementById('adminMenuLink');
            if (adminLink) adminLink.style.display = 'block';
        }
    })
    .catch(e => { /* Ignore on unauthenticated pages like login */ });

const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            
            if (data.success) {
                window.location.href = '/dashboard.html';
            } else {
                showAlert(data.error, 'danger');
            }
        } catch (err) {
            showAlert('Connection error', 'danger');
        }
    });
}

const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const full_name = document.getElementById('fullName').value;
        const username = document.getElementById('regUsername').value;
        const password = document.getElementById('regPassword').value;

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ full_name, username, password })
            });
            const data = await res.json();
            
            if (data.success) {
                showAlert('Registration successful! Redirecting to login...', 'success');
                setTimeout(() => window.location.href = '/index.html', 2000);
            } else {
                showAlert(data.error, 'danger');
            }
        } catch (err) {
            showAlert('Connection error', 'danger');
        }
    });
}

const profileForm = document.getElementById('profileForm');
if (profileForm) {
    // Fetch profile data on load for the form
    const loadProfileForm = async () => {
        try {
            const res = await fetch('/api/profile');
            if (res.status === 401) {
                window.location.href = '/index.html';
                return;
            }
            const user = await res.json();
            
            document.getElementById('profFullName').value = user.full_name || '';
            document.getElementById('profDepartment').value = user.department || '';
            document.getElementById('profPhone').value = user.phone || '';
            document.getElementById('profBio').value = user.bio || '';
        } catch (err) {
            console.error('Error loading profile');
        }
    };
    
    loadProfileForm();

    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const payload = {
            full_name: document.getElementById('profFullName').value,
            department: document.getElementById('profDepartment').value,
            phone: document.getElementById('profPhone').value,
            bio: document.getElementById('profBio').value
        };

        try {
            const res = await fetch('/api/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            
            if (data.success) {
                showAlert('Profile updated successfully', 'success');
                // Reload page to reflect potential role changes on navbar
                setTimeout(() => window.location.reload(), 1500);
            } else {
                showAlert(data.error || 'Update failed', 'danger');
            }
        } catch (err) {
            showAlert('Connection error', 'danger');
        }
    });
}

const announcementList = document.getElementById('announcementList');
if (announcementList) {
    fetch('/api/content/announcements')
        .then(res => {
            if (res.status === 401) window.location.href = '/index.html';
            return res.json();
        })
        .then(data => {
            if (data.success && data.data) {
                announcementList.innerHTML = '';
                data.data.forEach(item => {
                    announcementList.innerHTML += `
                        <div class="card" style="border-left: 4px solid var(--${item.type});">
                            <h3 style="margin-bottom: 0.5rem; color: var(--dark);">${item.title}</h3>
                            <p style="color: var(--secondary); font-size: 0.875rem; margin-bottom: 1rem;">Posted by ${item.author} | ${item.date}</p>
                            <p style="line-height: 1.6;">${item.content}</p>
                        </div>
                    `;
                });
            } else {
                announcementList.innerHTML = '<p>Failed to load announcements.</p>';
            }
        }).catch(err => {
            announcementList.innerHTML = '<p style="color:red;">Error loading content.</p>';
        });
}

const documentList = document.getElementById('documentList');
if (documentList) {
    fetch('/api/content/documents')
        .then(res => {
            if (res.status === 401) window.location.href = '/index.html';
            return res.json();
        })
        .then(data => {
            if (data.success && data.data) {
                documentList.innerHTML = '';
                data.data.forEach(item => {
                    let badgeBg = item.categoryClass === 'hr' ? '#e0e7ff' : (item.categoryClass === 'sec' ? '#fee2e2' : '#dcfce7');
                    let badgeColor = item.categoryClass === 'hr' ? '#4338ca' : (item.categoryClass === 'sec' ? '#b91c1c' : '#15803d');
                    
                    documentList.innerHTML += `
                        <tr>
                            <td style="padding: 1rem; border-bottom: 1px solid var(--light);">${item.name}</td>
                            <td style="padding: 1rem; border-bottom: 1px solid var(--light);">
                                <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem; font-weight: 500;">
                                    ${item.category}
                                </span>
                            </td>
                            <td style="padding: 1rem; border-bottom: 1px solid var(--light); color: var(--secondary);">${item.date}</td>
                            <td style="padding: 1rem; border-bottom: 1px solid var(--light);"><a href="#" style="color: var(--primary); text-decoration: none; font-weight: 500;">Download (${item.type})</a></td>
                        </tr>
                    `;
                });
            } else {
                documentList.innerHTML = '<tr><td colspan="4">Failed to load documents.</td></tr>';
            }
        }).catch(err => {
            documentList.innerHTML = '<tr><td colspan="4" style="color:red;">Error loading content.</td></tr>';
        });
}

const searchBtn = document.getElementById('searchBtn');
if (searchBtn) {
    searchBtn.addEventListener('click', async () => {
        const dept = document.getElementById('searchDept').value;
        const tbody = document.getElementById('employeeResults');
        const debugOutput = document.getElementById('debugOutput');
        
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Searching...</td></tr>';
        debugOutput.style.display = 'none';

        try {
            const res = await fetch(`/api/employees/search?department=${encodeURIComponent(dept)}`);
            const data = await res.json();
            
            if (res.status === 403 || res.status === 401) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red;">${data.error}</td></tr>`;
                return;
            }

            if (data.error) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red;">Query failed</td></tr>';
                debugOutput.textContent = data.error;
                debugOutput.style.display = 'block';
                return;
            }

            tbody.innerHTML = '';
            if (data.data && data.data.length > 0) {
                data.data.forEach(emp => {
                    const row = `<tr>
                        <td>${emp.name || ''}</td>
                        <td>${emp.email || ''}</td>
                        <td>${emp.department || ''}</td>
                        <td>${emp.position || ''}</td>
                    </tr>`;
                    tbody.innerHTML += row;
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No employees found</td></tr>';
            }
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red;">Connection error</td></tr>';
        }
    });
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/index.html';
    });
}
