"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LendingIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/lending/lend");
  }, [router]);

  return null;
}
