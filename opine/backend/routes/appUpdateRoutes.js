const express = require('express');
const router = express.Router();
const { checkAppUpdate, downloadApp } = require('../controllers/appUpdateController');

// Public routes (can add auth middleware if needed)
router.get('/check-update', checkAppUpdate);
router.get('/download/:versionCode', downloadApp);

module.exports = router;



