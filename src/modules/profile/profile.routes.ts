import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { uploadProfileImage } from '../../middleware/upload.middleware';
import { validate } from '../../middleware/validation.middleware';
import {
  getMyStatusHandler,
  removeProfilePhotoHandler,
  updateMyStatusHandler,
  uploadProfilePhotoHandler,
} from './profile.controller';
import { updateStatusSchema } from './profile.validation';

const router = Router();

// Every authenticated user (Admin or Staff) manages only their own photo —
// there's no :userId param here on purpose, so there's nothing to check
// ownership against; req.authUser.profileId is always the target.
router.use(requireAuth);

router.post('/photo', uploadProfileImage, uploadProfilePhotoHandler);
router.delete('/photo', removeProfilePhotoHandler);

// Staff presence (Active / Busy / Offline). Same "no :userId param" logic
// as above — req.authUser.profileId is always the target, so there is
// nothing for a Staff token to spoof here.
router.get('/status', getMyStatusHandler);
router.patch('/status', validate(updateStatusSchema), updateMyStatusHandler);

export default router;
