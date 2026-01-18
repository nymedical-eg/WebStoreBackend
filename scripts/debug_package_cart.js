const API_URL = 'http://localhost:5050/api';
let userToken = '';
let packageId = '';

const loginUser = async () => {
    try {
        const email = `test.package.${Date.now()}@example.com`;
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                firstName: 'Test', lastName: 'User', email, password: 'password123', phone: '0123456789',
                governorate: 'Cairo', city: 'Test City', address: '123 Test St'
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Login failed');
        userToken = data.token;
        console.log('User registered and logged in.');
    } catch (err) {
        console.error('Login failed:', err.message);
        process.exit(1);
    }
};

const getPackages = async () => {
    try {
        const res = await fetch(`${API_URL}/packages`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Fetch failed');
        
        if (data.length > 0) {
            packageId = data[0]._id;
            console.log('Using existing package:', packageId);
        } else {
             console.log('No packages found. Cannot test.');
             process.exit(1);
        }
    } catch (err) {
        console.error('Fetch packages failed:', err.message);
        process.exit(1);
    }
};

const addToCart = async () => {
    try {
        console.log('Attempting to add package to cart...');
        const res = await fetch(`${API_URL}/cart`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                packageId: packageId,
                quantity: 1
            })
        });
        const data = await res.json();
        if (!res.ok) {
            console.error('Add to cart FAILED:', data.message);
        } else {
            console.log('Add to cart SUCCESS:', JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.error('Add to cart Network Error:', err.message);
    }
};

const run = async () => {
    await loginUser();
    await getPackages();
    await addToCart();
};

run();
