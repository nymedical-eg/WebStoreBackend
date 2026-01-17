const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
require('dotenv').config();

const API_URL = 'http://localhost:5050/api';

async function request(endpoint, method = 'GET', body = null, token = null, adminRole = false) {
    const headers = {
        'Content-Type': 'application/json'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    if (adminRole) {
        headers['x-role'] = 'admin';
    }

    const options = {
        method,
        headers
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_URL}${endpoint}`, options);
    const contentType = response.headers.get("content-type");
    let data = null;
    if (contentType && contentType.includes("application/json")) {
        data = await response.json();
    } else {
        data = await response.text();
    }

    if (!response.ok) {
        throw new Error(JSON.stringify(data));
    }

    return { data, status: response.status };
}

async function runTest() {
    try {
        console.log('--- STARTING COUPON SYSTEM TEST ---');

        // Check if server is up
        try {
           await fetch('http://localhost:5050/');
        } catch (e) {
            console.error('ERROR: Server does not appear to be running on localhost:5050. Please start the server (e.g., node server.js) and try again.');
            process.exit(1);
        }

        // 1. Connect to DB to clean up previous test data if needed
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/webstore');
        console.log('Connected to DB');

        // Clean up test data
        await User.deleteOne({ email: 'testadmin@example.com' });
        await User.deleteOne({ email: 'testuser@example.com' });
        await Product.deleteOne({ name: 'Coupon Test Product' });
        await Coupon.deleteOne({ code: 'TEST50' });
        
        // 2. Register/Login Admin
        console.log('Creating Admin...');
        const adminReg = await request('/auth/register', 'POST', {
            firstName: 'Test',
            lastName: 'Admin',
            email: 'testadmin@example.com',
            phone: '1234567890',
            password: 'password123'
        });
        const adminToken = adminReg.data.token;
        
        // Force role to admin directly in DB because register defaults to user
        await User.updateOne({ email: 'testadmin@example.com' }, { role: 'admin' });
        console.log('Admin created and promoted.');

        // 3. Create Product
        console.log('Creating Product...');
        const productRes = await request('/products', 'POST', {
            name: 'Coupon Test Product',
            description: 'A product to test coupons',
            image: 'http://example.com/image.jpg',
            price: 100, // Easy number for math
            stock: 10
        }, adminToken);
        const productId = productRes.data._id;
        console.log(`Product created: ${productId} (Price: 100)`);

        // 4. Create Coupon
        console.log('Creating Coupon...');
        await request('/coupons', 'POST', {
            code: 'TEST50',
            discountPercentage: 50,
            maxUsage: 10,
            isActive: true
        }, null, true); // No token, but admin role header
        console.log('Coupon TEST50 created (50% off)');

        // 5. Register User
        console.log('Creating User...');
        const userReg = await request('/auth/register', 'POST', {
            firstName: 'Test',
            lastName: 'User',
            email: 'testuser@example.com',
            phone: '0987654321',
            password: 'password123'
        });
        const userToken = userReg.data.token;

        // 6. Add to Cart
        console.log('Adding to Cart...');
        await request('/cart', 'POST', {
            productId: productId,
            quantity: 2
        }, userToken);
        // Cart total should be 200

        // 7. Apply Coupon
        console.log('Applying Coupon...');
        await request('/cart/apply-coupon', 'POST', {
            code: 'TEST50'
        }, userToken);

        // 8. Check Cart Total
        const cartRes = await request('/cart', 'GET', null, userToken);
        console.log(`Cart Subtotal: ${cartRes.data.subtotal}`);
        console.log(`Cart Discount: ${cartRes.data.discountAmount}`);
        console.log(`Cart Total: ${cartRes.data.total}`);

        if (cartRes.data.total === 100) {
            console.log('SUCCESS: Cart total is correct (200 - 50% = 100)');
        } else {
            console.error('FAILURE: Cart total is incorrect (Expected 100)');
            process.exit(1);
        }

        // 9. Place Order
        console.log('Placing Order...');
        const orderRes = await request('/orders', 'POST', {}, userToken);
        const orderId = orderRes.data._id;
        console.log(`Order placed: ${orderId}`);
        console.log(`Order Total: ${orderRes.data.totalAmount}`);
        console.log(`Coupon Applied:`, orderRes.data.couponApplied);

        if (orderRes.data.totalAmount === 100 && orderRes.data.couponApplied.code === 'TEST50') {
             console.log('SUCCESS: Order total and coupon snapshot are correct');
        } else {
             console.error('FAILURE: Order details are incorrect');
             process.exit(1);
        }

        // 10. Check Coupon Usage
        const couponCheck = await Coupon.findOne({ code: 'TEST50' });
        if (couponCheck.usedCount === 1) {
            console.log('SUCCESS: Coupon usage count incremented');
        } else {
            console.error(`FAILURE: Coupon usage count is ${couponCheck.usedCount}`);
            process.exit(1);
        }
        
    } catch (err) {
        console.error('TEST FAILED with Error:', err.message);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
}

runTest();
