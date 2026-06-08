"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { QuoteImageRecord } from "@/lib/quotes/types";

function galleryClass(count: number) {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 md:grid-cols-2";
  return "grid-cols-1 md:grid-cols-2";
}

export function MockupGallery({ images }: { images: QuoteImageRecord[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);

  const activeImage = activeIndex === null ? null : images[activeIndex] || null;
  const visibleIndex = activeIndex ?? 0;
  const hasMultipleImages = images.length > 1;

  function openGallery(index: number) {
    setActiveIndex(index);
  }

  function closeGallery() {
    setActiveIndex(null);
  }

  function moveGallery(direction: -1 | 1) {
    setActiveIndex((current) => {
      if (current === null || !images.length) return current;
      return (current + direction + images.length) % images.length;
    });
  }

  function handleGalleryScroll() {
    if (activeIndex === null) return;

    const scroller = scrollerRef.current;
    if (!scroller) return;

    const nextIndex = Math.round(scroller.scrollLeft / Math.max(1, scroller.clientWidth));
    const boundedIndex = Math.max(0, Math.min(images.length - 1, nextIndex));
    if (boundedIndex !== activeIndex) setActiveIndex(boundedIndex);
  }

  useEffect(() => {
    if (activeIndex === null) return undefined;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeGallery();
      if (event.key === "ArrowLeft") moveGallery(-1);
      if (event.key === "ArrowRight") moveGallery(1);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeIndex]);

  useEffect(() => {
    if (activeIndex === null) return;

    slideRefs.current[activeIndex]?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "start",
    });
  }, [activeIndex]);

  if (!images.length) {
    return (
      <section className="rounded-lg border border-dashed border-black/20 bg-white p-8 text-center text-neutral-500">
        Mockup-Bilder werden fuer dieses Angebot noch nachgereicht.
      </section>
    );
  }

  return (
    <>
      <section aria-label="Mockup Bilder" className={`grid gap-4 ${galleryClass(images.length)}`}>
        {images.map((image, index) => (
          <figure
            key={image.id}
            className={`overflow-hidden rounded-lg border border-black/10 bg-white ${
              images.length === 3 && index === 0 ? "md:row-span-2" : ""
            }`}
          >
            <button
              type="button"
              className="group block h-full w-full cursor-zoom-in text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-[#fa31a2]/35"
              onClick={() => openGallery(index)}
              aria-label={`${image.label || `Mockup ${index + 1}`} gross anzeigen`}
            >
              <img
                src={image.storage_url}
                alt={image.label || `Mockup ${index + 1}`}
                className="h-full min-h-[260px] w-full object-cover transition duration-200 group-hover:scale-[1.015]"
              />
            </button>
          </figure>
        ))}
      </section>

      {activeImage ? (
        <div
          className="fixed inset-0 z-[100] bg-black/95 text-white"
          role="dialog"
          aria-modal="true"
          aria-label="Mockup Galerie"
        >
          <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur md:left-6 md:top-6">
            {visibleIndex + 1} / {images.length}
          </div>

          <button
            type="button"
            className="absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40 md:right-6 md:top-6"
            onClick={closeGallery}
            aria-label="Galerie schliessen"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>

          <div
            ref={scrollerRef}
            className="flex h-full w-full snap-x snap-mandatory overflow-x-auto"
            onScroll={handleGalleryScroll}
          >
            {images.map((image, index) => (
              <div
                key={image.id}
                ref={(node) => {
                  slideRefs.current[index] = node;
                }}
                className="flex h-full min-w-full snap-center items-center justify-center px-4 py-20 md:px-16"
              >
                <img
                  src={image.storage_url}
                  alt={image.label || `Mockup ${index + 1}`}
                  className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
                />
              </div>
            ))}
          </div>

          {hasMultipleImages ? (
            <>
              <button
                type="button"
                className="absolute left-3 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40 md:left-6 md:h-14 md:w-14"
                onClick={() => moveGallery(-1)}
                aria-label="Vorheriges Bild"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              </button>

              <button
                type="button"
                className="absolute right-3 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40 md:right-6 md:h-14 md:w-14"
                onClick={() => moveGallery(1)}
                aria-label="Naechstes Bild"
              >
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </button>

              <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 md:bottom-6">
                <div className="flex max-w-full gap-2 overflow-x-auto rounded-full bg-black/35 p-2 backdrop-blur">
                  {images.map((image, index) => (
                    <button
                      key={image.id}
                      type="button"
                      className={`h-16 w-20 flex-none overflow-hidden rounded-md border transition ${
                        index === visibleIndex
                          ? "border-white opacity-100"
                          : "border-white/20 opacity-60 hover:opacity-90"
                      }`}
                      onClick={() => setActiveIndex(index)}
                      aria-label={`${image.label || `Mockup ${index + 1}`} anzeigen`}
                    >
                      <img
                        src={image.storage_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
