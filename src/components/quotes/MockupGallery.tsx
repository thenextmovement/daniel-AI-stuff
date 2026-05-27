import type { QuoteImageRecord } from "@/lib/quotes/types";

function galleryClass(count: number) {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 md:grid-cols-2";
  return "grid-cols-1 md:grid-cols-2";
}

export function MockupGallery({ images }: { images: QuoteImageRecord[] }) {
  if (!images.length) {
    return (
      <section className="rounded-lg border border-dashed border-black/20 bg-white p-8 text-center text-neutral-500">
        Mockup-Bilder werden fuer dieses Angebot noch nachgereicht.
      </section>
    );
  }

  return (
    <section aria-label="Mockup Bilder" className={`grid gap-4 ${galleryClass(images.length)}`}>
      {images.map((image, index) => (
        <figure
          key={image.id}
          className={`overflow-hidden rounded-lg border border-black/10 bg-white ${
            images.length === 3 && index === 0 ? "md:row-span-2" : ""
          }`}
        >
          <img
            src={image.storage_url}
            alt={image.label || `Mockup ${index + 1}`}
            className="h-full min-h-[260px] w-full object-cover"
          />
        </figure>
      ))}
    </section>
  );
}
