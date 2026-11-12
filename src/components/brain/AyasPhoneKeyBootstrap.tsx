"use client";

import { useEffect } from "react";

import { bootstrapAyasPhoneKeyFromUrl } from "./ayasPhoneFallback";

/**
 * Renders nothing; captures a phone-gateway bootstrap key from the URL once on mount (see
 * `bootstrapAyasPhoneKeyFromUrl`). Placed on the login page (owner 2026-11-12, "kalan güvenlik açıklarını
 * kapatalım"): the bootstrap link now carries the key in the fragment (`/brain#ayasPhoneKey=…`), which never reaches
 * the PC — and an unauthenticated phone sees it on `/login`, where the browser carries the fragment through the
 * redirect, rather than on `/brain` after the login form's POST, which drops it.
 */
export function AyasPhoneKeyBootstrap(): null {
  useEffect(() => {
    bootstrapAyasPhoneKeyFromUrl(window);
  }, []);
  return null;
}
