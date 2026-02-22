import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, loginUser, refresh, logoutUser, me } from './auth.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

export const authRouter = Router();

// Strict rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, please try again in 15 minutes.' },
});

authRouter.post('/register', authLimiter, register);
authRouter.post('/login', authLimiter, loginUser);
authRouter.post('/refresh', authLimiter, refresh);
authRouter.post('/logout', logoutUser);
authRouter.get('/me', authenticate, me);
