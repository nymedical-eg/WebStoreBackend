require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/webstore')
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log(err));

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const productRoutes = require('./routes/productRoutes');
app.use('/api/products', productRoutes);

app.get('/', (req, res) => {
    res.send('API is running...');
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Test API at: http://localhost:${PORT}/api/products`);
});
