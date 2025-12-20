const isAdmin = (req, res, next) => {
    // Simple authentication/authorization
    // Checks for x-role: admin header
    const role = req.headers['x-role'];
    
    if (role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Access denied. Admins only.' });
    }
};

module.exports = { isAdmin };
