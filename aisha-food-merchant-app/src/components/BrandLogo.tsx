import Logo from "@/assets/logo.svg";

type BrandLogoProps = {
  size?: number;
};

export default function BrandLogo({ size = 72 }: BrandLogoProps) {
  return <Logo width={size} height={size} />;
}
