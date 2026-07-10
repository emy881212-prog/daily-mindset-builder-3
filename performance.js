document.addEventListener("DOMContentLoaded", () => {
  const processorCores = navigator.hardwareConcurrency || 8;
  const deviceMemory = navigator.deviceMemory || 8;

  if (processorCores <= 4 || deviceMemory <= 4) {
    document.body.classList.add("performance-lite");
  }

  document.querySelectorAll("img").forEach((image) => {
    if (!image.hasAttribute("loading")) {
      image.loading = "lazy";
    }

    image.decoding = "async";
  });

  document.querySelectorAll("video").forEach((video) => {
    if (!video.hasAttribute("preload")) {
      video.preload = "metadata";
    }
  });
});
