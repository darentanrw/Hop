import { ImageResponse } from "next/og";
import { siteMetadata, socialImageSize } from "../lib/site-metadata";
import { SocialPreviewImage } from "../lib/social-preview-image";

export const alt = siteMetadata.ogImageAlt;
export const size = socialImageSize;
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(<SocialPreviewImage />, size);
}
