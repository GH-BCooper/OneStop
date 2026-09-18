import { defineCategory } from "../define";

// Features §6. PDF → Image (§6.2) is the pdf-to-images entry in pdf.ts. The five fit modes of
// §6.25/§6.26 (fill, contain, stretch, repeat, blur background) are options, not separate tools.
// `model: "optional"` marks the tools that use a local AI model when one is configured and fall
// back to a built-in method otherwise (09-image-tools.md, apps/api/src/images/model.ts).
export const imageTools = defineCategory("images", { phase: "09", sub: "Images", status: "available" }, [
  { src: ["6.1"], name: "Image → PDF", in: ["image"], out: ["pdf"], batch: true, pop: 92, kw: ["jpg", "png", "photo", "picture", "scan", "convert"], desc: "Combine one or more images into a PDF." },
  { src: ["6.3"], name: "Image Resizer", in: ["image"], out: ["image"], batch: true, pop: 80, kw: ["resize", "dimensions", "scale", "width", "height", "photo"], desc: "Resize images to exact dimensions or a percentage." },
  { src: ["6.4"], name: "Image Cropper", in: ["image"], out: ["image"], pop: 55, kw: ["crop", "trim", "cut", "aspect ratio", "photo"], desc: "Crop an image to a region or aspect ratio." },
  { src: ["6.5"], name: "Image Compressor", in: ["image"], out: ["image"], batch: true, pop: 85, kw: ["shrink", "reduce size", "smaller", "optimize", "photo"], desc: "Reduce image file size with minimal quality loss." },
  { src: ["6.6"], name: "Image Format Converter", in: ["image"], out: ["jpg", "png", "webp", "gif", "bmp", "tiff"], batch: true, pop: 60, kw: ["convert", "change format", "photo"], desc: "Convert images between JPG, PNG, WebP, GIF and more." },
  { src: ["6.7"], name: "JPG ↔ PNG", slug: "jpg-png-converter", in: ["jpg", "jpeg", "png"], out: ["jpg", "png"], batch: true, pop: 50, kw: ["jpeg", "convert"], desc: "Convert between JPG and PNG." },
  { src: ["6.8"], name: "JPG ↔ WebP", slug: "jpg-webp-converter", in: ["jpg", "jpeg", "webp"], out: ["jpg", "webp"], batch: true, kw: ["jpeg", "convert"], desc: "Convert between JPG and WebP." },
  { src: ["6.9"], name: "PNG ↔ WebP", slug: "png-webp-converter", in: ["png", "webp"], out: ["png", "webp"], batch: true, kw: ["convert"], desc: "Convert between PNG and WebP." },
  { src: ["6.10"], name: "Image → GIF", in: ["image"], out: ["gif"], batch: true, kw: ["animation", "animated", "slideshow"], desc: "Turn one or more images into a GIF." },
  { src: ["6.11"], name: "Background Blur", model: "optional", in: ["image"], out: ["image"], kw: ["portrait", "bokeh", "blur background", "photo"], desc: "Blur the background behind the subject of a photo." },
  { src: ["6.12"], name: "Background Removal", model: "optional", in: ["image"], out: ["png"], batch: true, pop: 90, kw: ["remove background", "transparent", "cutout", "bg", "photo"], desc: "Remove the background from a photo, leaving a transparent PNG." },
  { src: ["6.13"], name: "Object Removal", model: "optional", in: ["image"], out: ["image"], kw: ["erase", "inpaint", "remove object", "photo"], desc: "Erase unwanted objects from a photo." },
  { src: ["6.14"], name: "Image Upscaler", model: "optional", in: ["image"], out: ["image"], pop: 45, kw: ["upscale", "enlarge", "super resolution", "higher resolution"], desc: "Enlarge an image while keeping it sharp." },
  { src: ["6.15"], name: "Image Enhancer", model: "optional", in: ["image"], out: ["image"], kw: ["enhance", "improve", "auto fix", "photo"], desc: "Automatically improve exposure, contrast and clarity." },
  { src: ["6.16"], name: "Image Sharpening", model: "optional", in: ["image"], out: ["image"], kw: ["sharpen", "blurry", "focus"], desc: "Sharpen a soft or slightly blurry image." },
  { src: ["6.17"], name: "Image Denoiser", model: "optional", in: ["image"], out: ["image"], kw: ["denoise", "noise", "grain"], desc: "Reduce noise and grain in a photo." },
  { src: ["6.18"], name: "Image Watermark", in: ["image"], out: ["image"], batch: true, kw: ["watermark", "logo", "stamp", "copyright"], desc: "Add a text or logo watermark to images." },
  { src: ["6.19"], name: "Add Text to Image", in: ["image"], out: ["image"], kw: ["caption", "overlay", "label", "write on photo"], desc: "Place text on top of an image." },
  { src: ["6.20"], name: "Image Metadata Viewer", in: ["image"], out: ["json"], kw: ["exif", "gps", "camera", "properties"], desc: "View EXIF and other metadata inside an image." },
  { src: ["6.21"], name: "Remove Image Metadata", in: ["image"], out: ["image"], batch: true, kw: ["exif", "gps", "strip", "privacy"], desc: "Strip EXIF, GPS and other metadata from images." },
  { src: ["6.22"], name: "Image Color Adjustment", in: ["image"], out: ["image"], kw: ["brightness", "contrast", "saturation", "hue", "colour"], desc: "Adjust brightness, contrast, saturation and hue." },
  { src: ["6.23"], name: "Rotate Image", in: ["image"], out: ["image"], batch: true, kw: ["turn", "orientation", "photo"], desc: "Rotate an image by any angle." },
  { src: ["6.24"], name: "Flip Image", in: ["image"], out: ["image"], batch: true, kw: ["mirror", "horizontal", "vertical", "photo"], desc: "Mirror an image horizontally or vertically." },
  { src: ["6.25"], name: "Fit Image to Square", in: ["image"], out: ["image"], batch: true, kw: ["square", "instagram", "fill", "contain", "stretch", "repeat", "blur background", "pad"], desc: "Fit an image into a square using fill, contain, stretch, repeat or blurred background." },
  { src: ["6.26"], name: "Fit Image to Circle", in: ["image"], out: ["png"], batch: true, kw: ["circle", "round", "avatar", "profile picture", "fill", "contain", "stretch", "repeat", "blur background"], desc: "Fit an image into a circle using fill, contain, stretch, repeat or blurred background." },
  { src: ["6.27"], name: "Meme Generator", in: ["image"], out: ["image"], pop: 30, kw: ["meme", "caption", "funny", "top text"], desc: "Add classic top and bottom meme captions to an image." },
  { src: ["6.28"], name: "Basic Image Editor", in: ["image"], out: ["image"], pop: 40, kw: ["edit", "draw", "annotate", "photo editor"], desc: "Crop, rotate, draw and annotate in a simple editor." },
]);
