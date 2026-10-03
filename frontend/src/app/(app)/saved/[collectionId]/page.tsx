'use client';

import { use } from 'react';
import { CollectionView } from '../saved-views';

/// `params` เป็น Promise ใน Next 16 — แกะด้วย React `use()`
export default function CollectionPage({ params }: PageProps<'/saved/[collectionId]'>) {
  const { collectionId } = use(params);

  return <CollectionView collectionId={decodeURIComponent(collectionId)} />;
}
