// ─────────────────────────────────────────────────────────────
// components/FeaturedListings.tsx — Featured artworks carousel
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useMarketplace } from "@/hooks/useMarketplace";
import { Listing, stroopsToXlm } from "@/lib/contract";
import { fetchMetadata, cidToGatewayUrl, ArtworkMetadata } from "@/lib/ipfs";
import { ArrowRight, ChevronLeft, ChevronRight, Tag, Eye } from "lucide-react";

interface EnrichedItem {
    listing: Listing;
    metadata: ArtworkMetadata | null;
    imageUrl: string;
}

// High-quality placeholder images for when no real listings exist
const PLACEHOLDER_ARTWORKS = [
    {
        title: "Ndebele Geometry",
        artist: "Traditional · South Africa",
        image: "https://images.unsplash.com/photo-1582582621959-48d27397dc69?w=600&h=600&fit=crop",
        price: "250",
    },
    {
        title: "Maasai Beadwork Essence",
        artist: "Contemporary · Kenya",
        image: "https://images.unsplash.com/photo-1590845947698-8924d7409b56?w=600&h=600&fit=crop",
        price: "180",
    },
    {
        title: "Bronze Kingdom Legacy",
        artist: "Classical · Nigeria",
        image: "https://images.unsplash.com/photo-1580136579312-94651dfd596d?w=600&h=600&fit=crop",
        price: "420",
    },
    {
        title: "Sahel Sunset Canvas",
        artist: "Modern · Mali",
        image: "https://images.unsplash.com/photo-1578926375605-eaf7559b1458?w=600&h=600&fit=crop",
        price: "310",
    },
    {
        title: "Kente Woven Dreams",
        artist: "Textile Art · Ghana",
        image: "https://images.unsplash.com/photo-1528699144885-3652875b4783?w=600&h=600&fit=crop",
        price: "195",
    },
    {
        title: "Baobab Spirit",
        artist: "Sculpture · Tanzania",
        image: "https://images.unsplash.com/photo-1559519529-0935f852b3a6?w=600&h=600&fit=crop",
        price: "375",
    },
];

export function FeaturedListings() {
    const { listings, isLoading } = useMarketplace();
    const [enriched, setEnriched] = useState<EnrichedItem[]>([]);
    const [scrollIdx, setScrollIdx] = useState(0);

    // Enrich the top 6 active listings with metadata
    useEffect(() => {
        const active = listings
            .filter((l: Listing) => l.status === "Active")
            .slice(0, 6);

        if (active.length === 0) return;

        Promise.all(
            active.map(async (listing) => {
                try {
                    const meta = await fetchMetadata(listing.metadata_cid);
                    return {
                        listing,
                        metadata: meta,
                        imageUrl: meta?.image
                            ? cidToGatewayUrl(meta.image)
                            : "/placeholder-art.svg",
                    };
                } catch {
                    return {
                        listing,
                        metadata: null,
                        imageUrl: "/placeholder-art.svg",
                    };
                }
            })
        ).then(setEnriched);
    }, [listings]);

    const displayItems = enriched.length > 0 ? enriched : null;
    const itemCount = displayItems ? displayItems.length : PLACEHOLDER_ARTWORKS.length;
    const maxScroll = Math.max(0, itemCount - 3);

    const scrollNext = useCallback(() => {
        setScrollIdx((prev) => Math.min(prev + 1, maxScroll));
    }, [maxScroll]);

    const scrollPrev = useCallback(() => {
        setScrollIdx((prev) => Math.max(prev - 1, 0));
    }, []);

    return (
        <section className="relative py-20 md:py-28">
            {/* Section header */}
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-12">
                    <div>
                        <p className="text-brand-500 font-semibold text-sm tracking-widest uppercase mb-3">
                            ✦ Curated Collection
                        </p>
                        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-midnight-900">
                            Featured <span className="text-brand-500">Artworks</span>
                        </h2>
                        <p className="mt-3 text-gray-500 max-w-lg text-base">
                            Handpicked masterpieces from across the continent — each piece tells a
                            story rooted in tradition and reimagined for the digital age.
                        </p>
                    </div>

                    {/* Navigation arrows */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={scrollPrev}
                            disabled={scrollIdx === 0}
                            className="flex items-center justify-center w-11 h-11 rounded-full border-2 border-brand-200 text-brand-600 hover:bg-brand-500 hover:text-white hover:border-brand-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-brand-600 disabled:hover:border-brand-200 transition-all duration-300"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        <button
                            onClick={scrollNext}
                            disabled={scrollIdx >= maxScroll}
                            className="flex items-center justify-center w-11 h-11 rounded-full border-2 border-brand-200 text-brand-600 hover:bg-brand-500 hover:text-white hover:border-brand-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-brand-600 disabled:hover:border-brand-200 transition-all duration-300"
                        >
                            <ChevronRight size={20} />
                        </button>
                    </div>
                </div>

                {/* Carousel / Grid */}
                <div className="overflow-hidden">
                    <div
                        className="flex gap-6 transition-transform duration-500 ease-out"
                        style={{
                            transform: `translateX(-${scrollIdx * (100 / 3 + 1.5)}%)`,
                        }}
                    >
                        {displayItems
                            ? displayItems.map((item, i) => (
                                <div
                                    key={item.listing.listing_id}
                                    className="min-w-[calc(33.333%-16px)] max-w-[calc(33.333%-16px)] flex-shrink-0 group relative"
                                    style={{ animationDelay: `${i * 150}ms` }}
                                >
                                    <Link href={`/listings/${item.listing.listing_id}`}>
                                        <div className="relative aspect-[4/5] rounded-2xl overflow-hidden corner-accent">
                                            <Image
                                                src={item.imageUrl}
                                                alt={item.metadata?.title ?? `Artwork #${item.listing.listing_id}`}
                                                fill
                                                className="object-cover transition-transform duration-700 group-hover:scale-110"
                                                unoptimized
                                            />
                                            {/* Gradient overlay */}
                                            <div className="absolute inset-0 bg-card-gradient opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                                            {/* Info overlay on hover */}
                                            <div className="absolute bottom-0 left-0 right-0 p-5 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500">
                                                <h3 className="text-white font-display font-bold text-lg">
                                                    {item.metadata?.title ?? `Artwork #${item.listing.listing_id}`}
                                                </h3>
                                                <p className="text-brand-200 text-sm mt-1">
                                                    {item.metadata?.artist ?? "Unknown Artist"}
                                                </p>
                                                <div className="flex items-center justify-between mt-3">
                                                    <div className="flex items-center gap-1.5 text-brand-400">
                                                        <Tag size={14} />
                                                        <span className="font-bold text-white">
                                                            {stroopsToXlm(item.listing.price)} XLM
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-white/70 text-sm">
                                                        <Eye size={14} />
                                                        View
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Status badge */}
                                            <span className="absolute top-4 right-4 bg-mint-500/90 text-white text-xs font-semibold px-3 py-1 rounded-full backdrop-blur-sm">
                                                {item.listing.status}
                                            </span>
                                        </div>
                                    </Link>
                                </div>
                            ))
                            : PLACEHOLDER_ARTWORKS.map((item, i) => (
                                <div
                                    key={i}
                                    className="min-w-[calc(33.333%-16px)] max-w-[calc(33.333%-16px)] flex-shrink-0 group relative"
                                    style={{ animationDelay: `${i * 150}ms` }}
                                >
                                    <Link href={`/listings/${i + 1}`}>
                                        <div className="relative aspect-[4/5] rounded-2xl overflow-hidden corner-accent cursor-pointer">
                                            <Image
                                                src={item.image}
                                                alt={item.title}
                                                fill
                                                className="object-cover transition-transform duration-700 group-hover:scale-110"
                                                unoptimized
                                            />
                                            <div className="absolute inset-0 bg-card-gradient opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                                            <div className="absolute bottom-0 left-0 right-0 p-5 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500">
                                                <h3 className="text-white font-display font-bold text-lg">
                                                    {item.title}
                                                </h3>
                                                <p className="text-brand-200 text-sm mt-1">{item.artist}</p>
                                                <div className="flex items-center justify-between mt-3">
                                                    <div className="flex items-center gap-1.5 text-brand-400">
                                                        <Tag size={14} />
                                                        <span className="font-bold text-white">
                                                            {item.price} XLM
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-white/70 text-sm">
                                                        <Eye size={14} />
                                                        Preview
                                                    </div>
                                                </div>
                                            </div>

                                            <span className="absolute top-4 right-4 bg-mint-500/90 text-white text-xs font-semibold px-3 py-1 rounded-full backdrop-blur-sm">
                                                Featured
                                            </span>
                                        </div>
                                    </Link>
                                </div>
                            ))}
                    </div>
                </div>

                {/* Mobile grid fallback */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-6 md:hidden">
                    {(displayItems ? displayItems.slice(0, 4) : PLACEHOLDER_ARTWORKS.slice(0, 4)).map(
                        (item, i) => (
                            <div
                                key={i}
                                className="group relative aspect-[4/5] rounded-2xl overflow-hidden"
                            >
                                <Image
                                    src={"imageUrl" in item ? item.imageUrl : (item as typeof PLACEHOLDER_ARTWORKS[0]).image}
                                    alt={"metadata" in item ? (item.metadata?.title ?? "Artwork") : (item as typeof PLACEHOLDER_ARTWORKS[0]).title}
                                    fill
                                    className="object-cover"
                                    unoptimized
                                />
                                <div className="absolute inset-0 bg-card-gradient" />
                                <div className="absolute bottom-0 left-0 right-0 p-4">
                                    <h3 className="text-white font-display font-bold">
                                        {"metadata" in item
                                            ? (item.metadata?.title ?? "Artwork")
                                            : (item as typeof PLACEHOLDER_ARTWORKS[0]).title}
                                    </h3>
                                    <p className="text-brand-300 text-sm">
                                        {"metadata" in item
                                            ? (item.metadata?.artist ?? "Unknown")
                                            : (item as typeof PLACEHOLDER_ARTWORKS[0]).artist}
                                    </p>
                                </div>
                            </div>
                        )
                    )}
                </div>

                {/* View All CTA */}
                <div className="text-center mt-12">
                    <Link
                        href="/explore"
                        className="inline-flex items-center gap-2 text-brand-600 font-semibold hover:text-brand-700 transition-colors group/link"
                    >
                        View All Artworks
                        <ArrowRight
                            size={18}
                            className="group-hover/link:translate-x-1 transition-transform"
                        />
                    </Link>
                </div>
            </div>
        </section>
    );
}
