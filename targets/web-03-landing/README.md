title: CyberNusa Official Landing Page
value: 500
description: The CyberNusa team just launched their official company Landing Page, built with the modern Next.js framework. They are incredibly proud of the website's performance, especially its lightning-fast image loading.

However, a security researcher has warned that the image optimization feature could backfire if configured carelessly.

Hidden within the application's source code is an internal API route at /api/internal/flag, meant strictly for admin use. This API generates an image that contains the flag.

Can you retrieve this flag image by exploiting a vulnerability on the Landing Page?

**Additional Information**
- Flag Format: `ITCLUB{...}`
- Website URL: `http://<SERVER_IP>:6060`