# Archived postcard back mockups

**These are dead. Do not implement any of them.**

These HTML files were design exploration WIPs from the v0.7.0.x cycle. They
were saved as comparison material when picking a direction. They are NOT
the production design.

## The actual production postcard back

Lives in code at:

    supabase/functions/lob-send-postcard/index.ts
    └── buildBackHtml()

Documented in:

    design-mockups/postcard-back/REPRODUCE_ACTUALLYSENT.md

If you are an AI assistant or a future engineer touching the postcard
back: read the function in `lob-send-postcard/index.ts` and the
REPRODUCE doc. Do not start from any file in this `_archived` directory.

## Why these were archived

Each one drifted from the actuallysent.pdf reference in a different way:
- `A-mirror-retro.html`. mirrored hero composition; lost the QR cluster
- `B-bold-wordmark.html`. wordmark dominated; broke the stamp hierarchy
- `C-vintage-purist.html`. vintage chrome; reproduction-too-faithful
- `C2-vintage-purist-v2.html`. second pass at C with adjustments
- `C2-print.html`. the closest to the saved reference, but reverse-engineered into the code already
- `D-minimal-modern.html`. modern flat; lost the postal feel entirely
- `index.html`. comparison index page that paired them up

The chosen direction (actuallysent.pdf as the reference, rebuilt into
`buildBackHtml()`) is documented in REPRODUCE_ACTUALLYSENT.md.

If you need to compare alternatives, do it against the current `buildBackHtml()`
output, not against these archives.
