const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Session expired, please log in again' : 'Invalid token';
    return res.status(401).json({ message });
  }

  try {
    // Checks the account still exists and the session was not revoked
    // (tokenVersion changes on password change/reset and "log out of all devices").
    const user = await User.findById(payload.id).select('tokenVersion').lean();
    if (!user || (user.tokenVersion || 0) !== (payload.tv || 0)) {
      return res.status(401).json({ message: 'Session expired, please log in again' });
    }
    req.user = { id: String(user._id) };
    return next();
  } catch (err) {
    return next(err);
  }
};
