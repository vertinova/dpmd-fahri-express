/**
 * Desa Context Middleware
 * Automatically handles desa_id based on user role
 * 
 * For DESA role: Always use user.desa_id (security: desa can only access their own data)
 * For ADMIN roles: Use desa_id from query parameter (admin can access any desa)
 * 
 * Usage: Add this middleware before endpoints that need desa_id
 */

const desaContextMiddleware = (req, res, next) => {
  const user = req.user;

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  // Admin roles that can access any desa
  const adminRoles = [
    'super_admin',
    'superadmin',
    'admin',
    'kepala_dinas',
    'sekretaris_dinas',
    'kepala_bidang',
    'pegawai',
    'pemberdayaan_masyarakat',
    'pmd',
    'bendahara'
  ];

  // Check if user is admin
  const isAdmin = adminRoles.includes(user.role);

  if (isAdmin) {
    // Admin: Use desa_id from query parameter if provided
    // If not provided, req.desaId will be undefined (controller handles this)
    if (req.query.desa_id) {
      req.desaId = BigInt(req.query.desa_id);
    }
    // Admin can proceed even without desa_id
  } else if (user.role === 'desa') {
    // Desa user: ALWAYS use their own desa_id (security)
    if (!user.desa_id) {
      return res.status(403).json({
        success: false,
        message: 'User desa tidak memiliki desa_id'
      });
    }
    req.desaId = user.desa_id;
    
    // Override query parameter to prevent desa from accessing other desa's data
    req.query.desa_id = user.desa_id.toString();
  } else {
    // Other roles (kecamatan, etc.) - allow access without desa_id
    // They might need to see all produk hukum
    if (req.query.desa_id) {
      req.desaId = BigInt(req.query.desa_id);
    }
  }

  next();
};

module.exports = desaContextMiddleware;
