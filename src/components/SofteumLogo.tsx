interface LogoProps {
  className?: string;
  variant?: "light" | "dark";
  showText?: boolean;
}

export function SofteumLogo({ className = "", variant = "light", showText = true }: LogoProps) {
  const textColor = variant === "light" ? "text-primary" : "text-sidebar-primary";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img src="/assets/softeum-logo.svg" alt="Softeum" className="h-9 w-9 object-contain" />
      {showText && (
        <span className={`text-lg font-bold tracking-tight ${textColor}`}>
          Softeum
        </span>
      )}
    </div>
  );
}
