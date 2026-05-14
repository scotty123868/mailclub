-- v0.7.0.21 — allow JPEG uploads to postcard-renders.
--
-- Build 32 switches the front photo render from PNG to JPEG q=0.92
-- (~5-8x smaller than PNG with no perceptible quality loss on photos).
-- The bucket was created in 2026051420 with allowed_mime_types =
-- {'image/png'}, which would reject every JPEG upload with
-- "mime type image/jpeg is not allowed".
--
-- Add image/jpeg alongside image/png. The back of the postcard stays
-- PNG (handwriting + QR + dividers — JPEG would create halos around
-- text and could break QR scannability), so both formats need to be
-- accepted.

update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg']
 where id = 'postcard-renders';
