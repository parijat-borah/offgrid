import type { Photo } from "@offgrid/core";
import { useState } from "react";

/** "Alok Kumar · CC BY-SA 4.0", linking to the file page. CC licences require the credit, so it's never hidden. */
function Credit({ photo, className = "", asText = false }: { photo: Photo; className?: string; asText?: boolean }) {
  // Inside a button a link would be a nested control, so the credit becomes plain text there.
  if (asText) return <span className={`truncate ${className}`}>📷 {photo.author} · {photo.license}</span>;
  return (
    <a href={photo.source_url} target="_blank" rel="noopener" className={`truncate underline-offset-2 hover:underline ${className}`}>
      📷 {photo.author} · {photo.license}
    </a>
  );
}

/** Photos load from Wikimedia and are cached once seen. Never seen and offline: a calm placeholder, not a broken image. */
function Img({ photo, alt, className, eager = false }: { photo: Photo; alt: string; className: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span role="img" aria-label={alt || "Photo not available offline"} className={`grid place-items-center bg-gradient-to-br from-pine-100 to-pine-50 text-center text-xs text-pine-800 ${className}`}>
        <span aria-hidden="true">
          <span className="block text-3xl">🏔️</span>
          Photo loads when you're online
        </span>
      </span>
    );
  }
  return (
    <img
      src={photo.url}
      alt={alt}
      width={photo.width}
      height={photo.height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}

/** One wide photo for cards and headers, with the credit on top of it. */
export function PlaceHero({
  photos,
  name,
  className = "aspect-[16/9] rounded-xl",
  eager,
  inButton = false,
}: {
  photos: Photo[] | undefined;
  name: string;
  className?: string;
  eager?: boolean;
  /** Set when the hero sits inside a clickable card, so the credit isn't a nested link. */
  inButton?: boolean;
}) {
  const photo = photos?.[0];
  if (!photo) return null;
  // A <button> may only contain phrasing content, so inside one the figure becomes plain spans.
  const Wrap = inButton ? "span" : "figure";
  const Caption = inButton ? "span" : "figcaption";
  return (
    <Wrap className={`relative block overflow-hidden bg-pine-50 ${className}`}>
      <Img photo={photo} alt={photo.caption ?? name} className="h-full w-full" eager={eager} />
      <Caption className="absolute inset-x-0 bottom-0 flex bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1 text-[11px] text-white">
        <Credit photo={photo} asText={inButton} />
      </Caption>
    </Wrap>
  );
}

/** Phones: a swipeable strip. Tablet and up: a mosaic, one large photo beside the others. Captions and credits overlay each photo. */
export function PlaceGallery({ photos, name }: { photos: Photo[] | undefined; name: string }) {
  if (!photos?.length) return null;
  const mosaic = photos.length >= 3;
  return (
    <section aria-label={`Photos of ${name}`}>
      <ul
        className={`scroll-thin -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:grid md:overflow-visible md:px-0 md:pb-0 ${
          mosaic ? "md:h-80 md:grid-cols-3 md:grid-rows-2 lg:h-96" : "md:grid-cols-2"
        }`}
      >
        {photos.slice(0, 3).map((p, i) => (
          <li key={p.file} className={`w-[85%] max-w-md shrink-0 snap-start md:w-auto md:max-w-none ${mosaic && i === 0 ? "md:col-span-2 md:row-span-2" : ""}`}>
            <figure className="relative h-full overflow-hidden rounded-xl bg-pine-50">
              <Img photo={p} alt={p.caption ?? `${name}, photo ${i + 1}`} className={`aspect-[3/2] w-full ${mosaic ? "md:aspect-auto md:h-full" : ""}`} eager={i === 0} />
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pt-8 pb-2 text-white">
                {p.caption && i === 0 && <span className="mb-0.5 line-clamp-1 text-sm font-semibold">{p.caption}</span>}
                <Credit photo={p} className="block text-[11px] text-white/90" />
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-muted">
        <span className="md:hidden">{photos.length > 1 ? `Swipe for ${photos.length - 1} more · ` : ""}</span>Photos from Wikimedia Commons, credited on each image.
      </p>
    </section>
  );
}

/** Small square thumbnail for lists (trips, timeline, "also fits"). */
export function PlaceThumb({ photos, name, className = "size-14" }: { photos: Photo[] | undefined; name: string; className?: string }) {
  const photo = photos?.[0];
  if (!photo) {
    return (
      <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-xl bg-pine-50 text-xl ${className}`}>
        🏔️
      </span>
    );
  }
  // Decorative next to the place name, so empty alt; the credit is on the place's own page.
  return <Img photo={photo} alt="" className={`shrink-0 rounded-xl ${className}`} />;
}
