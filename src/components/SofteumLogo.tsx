import { Package2 } from "lucide-react";

interface LogoProps {
  className?: string;
  variant?: "light" | "dark";
  showText?: boolean;
}

export function SofteumLogo({ className = "", variant = "light", showText = true }: LogoProps) {
  const textColor = variant === "light" ? "text-primary" : "text-sidebar-primary";
  const iconBg = variant === "light" ? "bg-primary text-primary-foreground" : "bg-sidebar-primary text-sidebar-primary-foreground";

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg} shadow-softeum-sm`}>
        <Package2 className="h-5 w-5" strokeWidth={2.5} />
      </div>
      {showText && (
        <span className={`text-lg font-bold tracking-tight ${textColor}`}>
          Softeum
        </span>
      )}
    </div>
  );
}
