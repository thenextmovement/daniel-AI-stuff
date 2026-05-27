"use client"

import { ThreeDPhotoCarousel } from "@/components/ui/3d-carousel"

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="text-center py-12">
        <h1 className="text-4xl font-bold mb-2">3D Carousel Demo</h1>
        <p className="text-white/60">Ziehen zum Drehen · Klicken zum Vergrößern</p>
      </div>

      {/* 3D Carousel */}
      <ThreeDPhotoCarousel />
    </main>
  )
}
