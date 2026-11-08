const showAlert = (message, type) => {
    const alertBox = document.getElementById('alertBox');
    if(alertBox) {
        alertBox.innerHTML = message;
        alertBox.className = `alert alert-${type}`;
        alertBox.style.display = 'block';
        setTimeout(() => alertBox.style.display = 'none', 5000);
    }
};

// Authentication
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
                // Set token in cookie so it's sent automatically
                document.cookie = `swag_session=${data.access_token}; path=/`;
                window.location.href = '/store.html';
            } else {
                showAlert(data.detail || 'Login failed', 'danger');
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
        const username = document.getElementById('regUsername').value;
        const password = document.getElementById('regPassword').value;

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            
            if (res.ok) {
                showAlert('Registration successful! Redirecting to login...', 'success');
                setTimeout(() => window.location.href = '/index.html', 1500);
            } else {
                showAlert(data.detail || 'Registration failed', 'danger');
            }
        } catch (err) {
            showAlert('Connection error', 'danger');
        }
    });
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST' });
        document.cookie = "swag_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        window.location.href = '/index.html';
    });
}

// Store Logic
const storeCatalog = document.getElementById('storeCatalog');
const userBalance = document.getElementById('userBalance');
const userInventory = document.getElementById('userInventory');
const usernameDisplay = document.getElementById('usernameDisplay');

const formatMoney = (amount) => {
    return '$' + amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

const loadStore = async () => {
    if (!storeCatalog) return;

    try {
        // Load Profile & Inventory
        const profileRes = await fetch('/api/store/profile');
        if (profileRes.status === 401) {
            window.location.href = '/index.html';
            return;
        }
        const profileData = await profileRes.json();
        const user = profileData.data;

        usernameDisplay.textContent = user.username;
        userBalance.textContent = formatMoney(user.balance);

        // Render Inventory
        if (user.inventory && user.inventory.length > 0) {
            userInventory.innerHTML = '';
            user.inventory.forEach(item => {
                userInventory.innerHTML += `
                    <div class="inventory-item">
                        <div class="inventory-info">
                            <img src="${item.image_url}" alt="${item.name}" class="inventory-img" onerror="this.src='/static/img/placeholder.webp'">
                            <div>
                                <div style="color: var(--light); font-weight: 500;">${item.name} <span style="color: var(--primary);">x${item.quantity}</span></div>
                                <div style="color: var(--text-light); font-size: 0.85rem;">Refund value: ${formatMoney(item.price)}</div>
                            </div>
                        </div>
                        <button class="btn btn-danger" style="padding: 0.5rem 1rem; width: auto;" onclick="sellItem(${item.id})">Sell</button>
                    </div>
                `;
            });
        } else {
            userInventory.innerHTML = '<p style="color: var(--text-light); text-align: center; margin-top: 1rem;">Inventory is empty</p>';
        }

        // Load Catalog
        const itemsRes = await fetch('/api/store/items');
        const itemsData = await itemsRes.json();
        
        storeCatalog.innerHTML = '';
        itemsData.data.forEach(item => {
            storeCatalog.innerHTML += `
                <div class="item-card">
                    <img src="${item.image_url}" alt="${item.name}" class="item-img" onerror="this.src='/static/img/placeholder.webp'">
                    <div class="item-body">
                        <h3 class="item-title">${item.name}</h3>
                        <p class="item-desc">${item.description}</p>
                        <div class="item-price">${formatMoney(item.price)}</div>
                        <button class="btn btn-primary" onclick="buyItem(${item.id})">Buy Item</button>
                    </div>
                </div>
            `;
        });

    } catch (err) {
        console.error(err);
        showAlert('Error loading store data', 'danger');
    }
};

window.buyItem = async (itemId) => {
    try {
        const res = await fetch('/api/store/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId })
        });
        const data = await res.json();
        
        if (data.success) {
            showAlert('Item purchased successfully', 'success');
            loadStore();
        } else {
            showAlert(data.error || 'Purchase failed', 'danger');
        }
    } catch (err) {
        showAlert('Connection error', 'danger');
    }
};

window.sellItem = async (itemId) => {
    try {
        const res = await fetch('/api/store/sell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId })
        });
        
        if (res.status === 429) {
            showAlert('Rate limit exceeded! Please slow down.', 'danger');
            return;
        }

        const data = await res.json();
        
        if (data.success) {
            showAlert(data.message, 'success');
            loadStore();
        } else {
            showAlert(data.error || 'Sale failed', 'danger');
        }
    } catch (err) {
        showAlert('Connection error', 'danger');
    }
};

if (storeCatalog) {
    loadStore();
}
