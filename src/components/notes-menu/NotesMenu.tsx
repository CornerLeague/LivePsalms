// src/components/notes-menu/NotesMenu.tsx
import { Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { navItems, NAV_TRIGGER_LABELS } from '@/data/projects';
import { cn } from '@/lib/utils';

export interface NotesMenuProps {
  /** Fired when a nav label in NAV_TRIGGER_LABELS is tapped (loading-overlay parity with MobileBottomDock). */
  onNavTrigger?: () => void;
  /** Classes merged onto the hamburger trigger button (sizing/radius per platform). */
  className?: string;
  /** Dropdown panel alignment relative to the trigger. Defaults to 'end' (right-anchored). */
  align?: 'start' | 'end';
  /** Hamburger icon size in px. Defaults to 18. */
  iconSize?: number;
}

/**
 * Site-navigation menu for the notes workspace (mobile + desktop). A plain
 * 3-line hamburger trigger opens a soft dropdown mirroring the site MENU
 * relocated from MobileBottomDock: the four navItems links + a Social/Instagram
 * row. Built on the shared Radix DropdownMenu primitive, which supplies keyboard
 * navigation, Escape/outside-click dismissal, anchored positioning, and
 * .dark-class-scoped popover tokens (never prefers-color-scheme). Presentational
 * + navigational only — open/close state is owned by the primitive.
 */
export function NotesMenu({ onNavTrigger, className, align = 'end', iconSize = 18 }: NotesMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu"
          className={cn(
            'flex items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/10',
            className,
          )}
          style={{ color: 'var(--deep-umber)' }}
        >
          <Menu size={iconSize} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        style={{ fontFamily: 'Outfit, sans-serif', minWidth: 176 }}
      >
        {navItems.map((item) => (
          <DropdownMenuItem
            key={item.label}
            asChild
            style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13 }}
          >
            <Link
              to={item.href}
              onClick={() => {
                if (NAV_TRIGGER_LABELS.has(item.label)) onNavTrigger?.();
              }}
            >
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            opacity: 0.6,
          }}
        >
          Social
        </DropdownMenuLabel>
        <DropdownMenuItem asChild style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13 }}>
          <a href="https://instagram.com" target="_blank" rel="noopener noreferrer">
            Instagram
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
