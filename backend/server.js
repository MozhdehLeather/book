const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const PORT = 2002;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Directories
const profilesDir = path.join(__dirname, 'data', 'profiles');
const tempDir = path.join(__dirname, 'temp');

// Create directories if they don't exist
async function ensureDirectories() {
  try {
    await fs.mkdir(profilesDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });
    console.log('✅ Directories ready');
  } catch (error) {
    // Directory already exists - that's fine
    console.log('📁 Directories already exist');
  }
}

// Initialize
ensureDirectories();

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/images', express.static(profilesDir));

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Helper functions
const getProfilePath = (id) => path.join(profilesDir, id);
const getPhotoPath = (id, photoName) => path.join(profilesDir, id, photoName);
const getJsonPath = (id) => path.join(profilesDir, id, 'profile.json');

// Check if path exists
async function pathExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

// API Routes

// 1. Create profile
app.post('/api/profiles', upload.single('photo'), async (req, res) => {
  try {
    const { name, address, contact, date, note } = req.body;
    
    if (!name || !address || !date || !note || !req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required' 
      });
    }

    const id = uuidv4();
    const profilePath = getProfilePath(id);
    
    // Create profile directory
    await fs.mkdir(profilePath, { recursive: true });

    // Save photo
    const photoExt = path.extname(req.file.originalname).toLowerCase();
    const photoName = `photo${photoExt}`;
    const photoPath = getPhotoPath(id, photoName);
    await fs.rename(req.file.path, photoPath);

    // Create profile data
    const profileData = {
      id,
      name: name.trim(),
      address: address.trim(),
      contact: contact ? contact.trim() : null,
      photo: photoName,
      date,
      note: note.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save JSON
    await fs.writeFile(getJsonPath(id), JSON.stringify(profileData, null, 2));

    res.json({
      success: true,
      id,
      link: `/profile.html?id=${id}`,
      message: 'Profile created successfully'
    });

  } catch (error) {
    console.error('Create error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create profile' 
    });
  }
});

// 2. Get all profiles
app.get('/api/profiles', async (req, res) => {
  try {
    const profiles = [];
    
    if (await pathExists(profilesDir)) {
      const folders = await fs.readdir(profilesDir);
      
      for (const folder of folders) {
        const jsonPath = getJsonPath(folder);
        if (await pathExists(jsonPath)) {
          const data = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
          profiles.push({
            id: data.id,
            name: data.name,
            date: data.date,
            photo: `/images/${data.id}/${data.photo}`,
            note: data.note.substring(0, 50) + (data.note.length > 50 ? '...' : '')
          });
        }
      }
    }
    
    // Sort by date (newest first)
    profiles.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    res.json(profiles);
    
  } catch (error) {
    console.error('Get all error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch profiles' 
    });
  }
});

// 3. Get single profile
app.get('/api/profiles/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const jsonPath = getJsonPath(id);
    
    if (await pathExists(jsonPath)) {
      const data = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
      data.photoUrl = `/images/${data.id}/${data.photo}`;
      res.json(data);
    } else {
      res.status(404).json({ 
        success: false, 
        error: 'Profile not found' 
      });
    }
    
  } catch (error) {
    console.error('Get single error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch profile' 
    });
  }
});

// 4. Update profile (simplified - only updates JSON, not photo)
app.put('/api/profiles/:id', upload.single('photo'), async (req, res) => {
  try {
    const id = req.params.id;
    const { name, address, contact, date, note } = req.body;
    const jsonPath = getJsonPath(id);
    
    if (!await pathExists(jsonPath)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Profile not found' 
      });
    }

    // Get existing data
    const existingData = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    
    // Update fields
    existingData.name = name.trim();
    existingData.address = address.trim();
    existingData.contact = contact ? contact.trim() : null;
    existingData.date = date;
    existingData.note = note.trim();
    existingData.updatedAt = new Date().toISOString();

    // Handle new photo if uploaded
    if (req.file) {
      // Delete old photo if exists
      const oldPhotoPath = getPhotoPath(id, existingData.photo);
      if (await pathExists(oldPhotoPath)) {
        await fs.unlink(oldPhotoPath);
      }
      
      // Save new photo
      const photoExt = path.extname(req.file.originalname).toLowerCase();
      const newPhotoName = `photo${photoExt}`;
      const newPhotoPath = getPhotoPath(id, newPhotoName);
      await fs.rename(req.file.path, newPhotoPath);
      existingData.photo = newPhotoName;
    }

    // Save updated data
    await fs.writeFile(jsonPath, JSON.stringify(existingData, null, 2));

    res.json({
      success: true,
      id,
      link: `/profile.html?id=${id}`,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update profile' 
    });
  }
});

// 5. Delete profile
app.delete('/api/profiles/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const profilePath = getProfilePath(id);
    
    if (await pathExists(profilePath)) {
      await fs.rm(profilePath, { recursive: true, force: true });
      res.json({ 
        success: true, 
        message: 'Profile deleted successfully' 
      });
    } else {
      res.status(404).json({ 
        success: false, 
        error: 'Profile not found' 
      });
    }
    
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete profile' 
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false, 
        error: 'File too large. Max 5MB' 
      });
    }
  }
  
  console.error('Server error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error' 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📱 Admin: http://localhost:${PORT}/admin.html`);
});