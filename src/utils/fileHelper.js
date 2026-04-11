const fs = require('fs');
const path = require('path');

/**
 * Copy file to reference directory for mirroring
 * Used when Dinas approves proposal - creates permanent reference copy
 * 
 * @param {string} fileName - Original filename from file_proposal field
 * @param {string} sourceDir - Source directory (default: 'bankeu')
 * @param {string} destDir - Destination directory (default: 'bankeu_reference')
 * @returns {Promise<boolean>} - true if success, throws error if failed
 */
const copyFileToReference = async (fileName, sourceDir = 'bankeu', destDir = 'bankeu_reference') => {
  try {
    if (!fileName) {
      throw new Error('Filename is required');
    }

    // Build absolute paths (fileName may contain nested dirs like "17/182/file.pdf")
    const storageRoot = path.join(__dirname, '../../storage/uploads');
    const sourcePath = path.join(storageRoot, sourceDir, fileName);
    const destPath = path.join(storageRoot, destDir, fileName);
    const destDirPath = path.dirname(destPath);

    // Check if source file exists
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file not found: ${sourcePath}`);
    }

    // Create destination directory (including nested subdirs) if not exists
    if (!fs.existsSync(destDirPath)) {
      fs.mkdirSync(destDirPath, { recursive: true });
    }

    // Copy file (overwrite if exists)
    fs.copyFileSync(sourcePath, destPath);

    console.log(`[File Mirroring] Successfully copied: ${fileName}`);
    console.log(`  Source: ${sourcePath}`);
    console.log(`  Dest:   ${destPath}`);

    return true;

  } catch (error) {
    console.error('[File Mirroring] Copy failed:', error.message);
    throw new Error(`Failed to copy file for mirroring: ${error.message}`);
  }
};

/**
 * Delete file from storage
 * 
 * @param {string} fileName - Filename to delete
 * @param {string} directory - Directory name (default: 'bankeu')
 * @returns {Promise<boolean>} - true if success or file not found
 */
const deleteFile = async (fileName, directory = 'bankeu') => {
  try {
    if (!fileName) return true;

    const filePath = path.join(__dirname, '../../storage/uploads', directory, fileName);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[File Delete] Successfully deleted: ${fileName}`);
      return true;
    } else {
      console.log(`[File Delete] File not found (skipped): ${fileName}`);
      return true;
    }

  } catch (error) {
    console.error('[File Delete] Delete failed:', error.message);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
};

/**
 * Check if file exists in storage
 * 
 * @param {string} fileName - Filename to check
 * @param {string} directory - Directory name (default: 'bankeu')
 * @returns {boolean} - true if exists
 */
const fileExists = (fileName, directory = 'bankeu') => {
  if (!fileName) return false;
  
  const filePath = path.join(__dirname, '../../storage/uploads', directory, fileName);
  return fs.existsSync(filePath);
};

/**
 * Get file info (size, created date, etc.)
 * 
 * @param {string} fileName - Filename
 * @param {string} directory - Directory name (default: 'bankeu')
 * @returns {Object|null} - File stats or null if not found
 */
const getFileInfo = (fileName, directory = 'bankeu') => {
  try {
    if (!fileName) return null;

    const filePath = path.join(__dirname, '../../storage/uploads', directory, fileName);
    
    if (!fs.existsSync(filePath)) return null;

    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      path: filePath
    };

  } catch (error) {
    console.error('[File Info] Error:', error.message);
    return null;
  }
};

module.exports = {
  copyFileToReference,
  deleteFile,
  fileExists,
  getFileInfo
};
