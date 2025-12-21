# CSS Architecture Documentation

## Overview

The Ciphermaniac CSS has been completely refactored from a monolithic 7,846-line file into a modular, maintainable architecture with clear boundaries and consistent patterns.

## Architecture Benefits

### ✅ **Before vs After**

| Metric              | Before                           | After                     | Improvement   |
| ------------------- | -------------------------------- | ------------------------- | ------------- |
| **Structure**       | Single 7,846-line file           | 13 modular files          | 100% modular  |
| **Maintainability** | Low - difficult to navigate      | High - clear organization | ⬆️ Excellent  |
| **Conflicts**       | Many duplicate/conflicting rules | Zero conflicts            | ✅ Resolved   |
| **Design System**   | Scattered values                 | Centralized design tokens | ✅ Systematic |
| **Performance**     | Redundant CSS                    | Optimized selectors       | ⬆️ Improved   |

## Directory Structure

```
public/assets/styles/
├── abstracts/
│   └── _variables.css          # Design tokens & CSS custom properties
├── base/
│   └── _reset.css              # CSS reset, base typography, utilities
├── components/
│   ├── _buttons.css            # All button variants & states
│   ├── _cards.css              # Card system, thumbnails, badges
│   └── _forms.css              # Forms, filters, inputs, dropdowns
├── layout/
│   ├── _header.css             # Header & footer components
│   ├── _toolbar.css            # Search toolbar & filters
│   └── _grid.css               # Grid systems & layouts
├── pages/
│   ├── _home.css               # Home page specific styles
│   ├── _trends.css             # Trends/charts page styles
│   ├── _archetype.css          # Archetype page styles
│   └── _responsive.css         # Responsive utilities
└── main.css                    # Main layout & base components
```

## Design System

### CSS Custom Properties (Design Tokens)

All colors, spacing, typography, and other design values are now centralized in `abstracts/_variables.css`:

```css
:root {
  /* Colors */
  --bg: #121317;
  --panel: #17181d;
  --text: #eef1f7;
  --muted: #a3a8b7;
  --accent: #ff6b6b;
  --accent-2: #6aa3ff;

  /* Spacing Scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  /* ... up to space-20 */

  /* Typography */
  --font-size-xs: 11px;
  --font-size-sm: 12px;
  --font-size-base: 14px;
  /* ... */

  /* Transitions */
  --transition-fast: 0.15s ease;
  --transition-normal: 0.2s ease;
  --transition-slow: 0.3s ease;
}
```

### Benefits of Design Tokens

1. **Consistency** - All components use the same values
2. **Easy theming** - Change once, applies everywhere
3. **Maintainability** - Update design system in one place
4. **Performance** - Browser optimizes custom property lookups

## Component Architecture

### Naming Convention

We use a **BEM-inspired** naming system with clear patterns:

```css
/* Block */
.card {
}

/* Block__Element */
.card__thumbnail {
}
.card__title {
}

/* Block--Modifier */
.card--featured {
}

/* State */
.card.is-active {
}
.card.is-loading {
}
```

### Component Organization

Each component module follows this structure:

1. **Base styles** - Default component appearance
2. **Variants** - Different versions (primary, secondary, etc.)
3. **States** - Hover, active, disabled, etc.
4. **Responsive** - Mobile adjustments
5. **Utilities** - Helper classes specific to component

### Example: Button Component

```css
/* Base button */
.btn {
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border-primary);
  padding: var(--space-3) var(--space-4);
  transition: var(--transition-normal);
}

/* Variants */
.btn--primary {
  background: var(--accent-2);
}
.btn--secondary {
  background: transparent;
}

/* States */
.btn:hover {
  transform: translateY(-1px);
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Responsive */
@media (max-width: 720px) {
  .btn {
    min-height: 48px;
  }
}
```

## Responsive Design Strategy

### Mobile-First Approach

All CSS is written mobile-first with progressive enhancement:

```css
/* Mobile (default) */
.grid {
  grid-template-columns: 1fr;
  gap: var(--space-2);
}

/* Tablet */
@media (min-width: 720px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
  }
}

/* Desktop */
@media (min-width: 900px) {
  .grid {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-4);
  }
}
```

### Breakpoint System

| Breakpoint | Min Width | Target Devices   |
| ---------- | --------- | ---------------- |
| Mobile     | 0px       | Phones (default) |
| Small      | 560px     | Large phones     |
| Tablet     | 720px     | Tablets          |
| Desktop    | 900px     | Small desktops   |
| Large      | 1200px    | Large desktops   |

## Performance Optimizations

### 1. Eliminated Redundancy

- **Removed** duplicate rules
- **Consolidated** similar selectors
- **Standardized** naming patterns

### 2. Optimized Selectors

**Before:**

```css
body > main > .container > .card-grid > .card:nth-child(3) {
}
```

**After:**

```css
.card {
}
.card--featured {
}
```

### 3. Reduced Specificity Wars

All components use low-specificity selectors, preventing conflicts:

```css
/* Low specificity - easy to override */
.btn {
}
.btn--primary {
}

/* Avoid high specificity */
#app .container div.buttons button.primary {
} /* ❌ */
```

### 4. CSS Containment

For performance-critical sections:

```css
.card-grid {
  contain: layout style paint;
}
```

## Building the CSS

### Development Build

```bash
node scripts/build-css-simple.mjs
```

This combines all modular CSS files into `style-optimized.css`.

### Production Build

For production, you can add:

1. **Minification** - Remove whitespace & comments
2. **Autoprefixer** - Add vendor prefixes
3. **PurgeCSS** - Remove unused styles
4. **GZIP** - Compress final file

## Migration Guide

### Switching from Old to New CSS

1. **Backup** - Original CSS is saved as `style.css.backup-[date]`

2. **Update HTML** - Change CSS reference:

   ```html
   <!-- Old -->
   <link rel="stylesheet" href="/assets/style.css" />

   <!-- New -->
   <link rel="stylesheet" href="/assets/style-optimized.css" />
   ```

3. **Test** - Verify all pages render correctly

4. **Report Issues** - If styling breaks, check browser console

### Rollback Plan

If issues occur, rollback is simple:

```html
<link rel="stylesheet" href="/assets/style.css" />
```

## Maintenance Guide

### Adding New Styles

1. **Identify Category**
   - Is it a component? → `components/`
   - Is it page-specific? → `pages/`
   - Is it a layout pattern? → `layout/`

2. **Use Design Tokens**

   ```css
   /* ✅ Good */
   .new-component {
     padding: var(--space-4);
     color: var(--text);
     background: var(--panel);
   }

   /* ❌ Avoid */
   .new-component {
     padding: 16px;
     color: #eef1f7;
     background: #17181d;
   }
   ```

3. **Follow Naming Convention**
   - Use BEM-inspired names
   - Use `is-` prefix for states
   - Use `--` for modifiers

4. **Add to Build**
   - Edit `scripts/build-css-simple.mjs`
   - Add new file to `files` array
   - Rebuild with `node scripts/build-css-simple.mjs`

### Modifying Existing Styles

1. **Find the right module** - Use directory structure
2. **Make changes** - Edit the specific module file
3. **Rebuild** - Run build script
4. **Test** - Verify changes work correctly

## Best Practices

### DO ✅

- Use CSS custom properties for all values
- Write mobile-first responsive styles
- Use low-specificity selectors
- Group related styles in same module
- Document complex CSS with comments
- Test across different viewports

### DON'T ❌

- Use inline styles
- Use `!important` (except for utilities)
- Hardcode color/spacing values
- Create overly-specific selectors
- Mix concerns across modules
- Forget to rebuild after changes

## Troubleshooting

### Styles Not Applying

1. Check build succeeded: `node scripts/build-css-simple.mjs`
2. Clear browser cache
3. Verify HTML references correct CSS file
4. Check browser console for errors

### Conflicting Styles

1. Use browser DevTools to inspect element
2. Check selector specificity
3. Verify correct module is loaded
4. Check for typos in class names

### Performance Issues

1. Run Lighthouse audit
2. Check for unused CSS with Coverage tool
3. Verify CSS file is cached properly
4. Consider code-splitting for large apps

## Future Enhancements

### Potential Improvements

1. **CSS-in-JS** - For dynamic theming
2. **PostCSS Pipeline** - Advanced processing
3. **Critical CSS** - Inline above-fold styles
4. **Component Library** - Documented component system
5. **Design Tokens JSON** - Export to other platforms

## Support

For questions or issues:

1. Check this documentation
2. Review module source code
3. Test in isolation
4. Create detailed bug report

---

**Last Updated:** December 2025  
**Architecture Version:** 1.0.0  
**Build Tool:** build-css-simple.mjs
