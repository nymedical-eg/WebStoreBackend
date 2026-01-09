const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { isAdmin } = require('../middleware/auth');

// @desc    Get all users (Admin only)
// @route   GET /api/users
// @access  Private/Admin
router.get('/', isAdmin, async (req, res) => {
    try {
        // Fetch all users, excluding the password field
        const users = await User.find({}).select('-password');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Get all admin users (Admin only)
// @route   GET /api/users/admins
// @access  Private/Admin
router.get('/admins', isAdmin, async (req, res) => {
    try {
        // Fetch users with role 'admin', excluding the password field
        const admins = await User.find({ role: 'admin' }).select('-password');
        res.json(admins);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

module.exports = router;
