# Car Market — Full-Stack Marketplace

A production-style car marketplace built with **React, Supabase, and PostgreSQL**, focused on real-world data modeling, UX patterns, and full-stack ownership.

This project intentionally goes beyond CRUD to demonstrate **senior-level decision making** around architecture, performance, and user experience.

https://car-market-1fq.pages.dev/

---

## ✨ Key Features

- Browse listings with **filtering, sorting, pagination, and URL sync**
- Listing details with **image gallery + cover photo**
- Seller flow: **create → edit → upload images**
- **Multi-image upload** with Supabase Storage
- **Reorder images & set cover photo**
- **Optimistic UI** for image actions and favorites
- **Favorites (saved cars)** per user
- Auth-aware permissions (seller vs viewer)

---

## 🧱 Architecture Overview

```
┌──────────────┐
│   Frontend   │
│  (React +    │
│ React Query) │
└──────┬───────┘
       │
       │ REST / PostgREST
       │
┌──────▼──────────┐
│   Supabase API  │
│  (PostgreSQL)  │
└──────┬──────────┘
       │
       │ File refs (bucket + path)
       │
┌──────▼──────────┐
│ Supabase Storage│
│  (Images only)  │
└─────────────────┘
```

---

## 🗄️ Database Schema (Simplified)

### `listings`
Core marketplace entity.

```sql
listings (
  id uuid PK,
  seller_id uuid,
  make text,
  model text,
  year int,
  price numeric,
  mileage int,
  description text,
  is_active boolean,
  created_at timestamptz
)
```

---

### `listing_images`
Normalized image storage with explicit ordering.

```sql
listing_images (
  id uuid PK,
  listing_id uuid FK → listings.id,
  bucket text,
  path text,
  position int,
  created_at timestamptz,
  UNIQUE (listing_id, position)
)
```

---

### `favorites`
User → listing relationship.

```sql
favorites (
  id uuid PK,
  user_id uuid,
  listing_id uuid,
  created_at timestamptz,
  UNIQUE (user_id, listing_id)
)
```

---

## ⚖️ Trade-offs & Design Decisions

### Why a separate `listing_images` table?
- Enables reordering and cover selection
- Avoids rewriting arrays
- Scales like real marketplaces

### Why `position` instead of `is_cover`?
- Single source of truth
- No conflicting flags
- Reorder = cover change

### Why Optimistic UI?
- Instant UX
- Matches modern apps
- Shows async state mastery

### Why not store image URLs?
- URLs can change
- Paths are stable identifiers
- Storage concerns stay out of DB

---

## 🚀 What This Project Demonstrates

- Full-stack ownership
- Production-grade data modeling
- Thoughtful trade-offs
- Senior-level UX patterns

---

## 🛠️ Tech Stack

- React, TypeScript
- React Query
- Supabase (Postgres, Auth, Storage)
- Tailwind CSS

---

## 👤 Author

Built by **Artem Kalus**
