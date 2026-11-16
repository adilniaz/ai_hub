interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 22, className }: LogoProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      height={size}
      viewBox="0 0 32 32"
      width={size}
    >
      <path d="M16 1.6c.66 7.27 7.13 13.74 14.4 14.4-7.27.66-13.74 7.13-14.4 14.4C15.34 23.13 8.87 16.66 1.6 16 8.87 15.34 15.34 8.87 16 1.6Z" />
    </svg>
  );
}
