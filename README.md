# proprietary-cam-parser

## Current Status

✅ FVFS parsing implemented

✅ Video extraction working

✅ GPS extraction working

✅ Pixel 6a deployment working

⚠ Audio reconstruction contains noise

⚠ Need validation with additional datasets

⚠ Performance optimization required

## Help Wanted

I am a beginner who started learning AI development recently.

I would appreciate advice regarding:

- Audio reconstruction
- GPS synchronization
- Performance optimization
- Testing and validation

## What I currently believe

After approximately 100 hours of experimentation and testing, my current understanding is:

* Video streams appear to be stored inside RIFF-like chunks.
* GPS data (location, speed, UTC timestamps) can be extracted and synchronized.
* Audio appears to be fragmented and may exist in multiple locations.
* Some index/metadata information may exist near the footer region.
* Day-shift and night-shift recordings appear to be mixed together.

Important:

These observations are based on empirical testing and are not yet fully verified.

I would greatly appreciate validation from developers with reverse-engineering experience.
