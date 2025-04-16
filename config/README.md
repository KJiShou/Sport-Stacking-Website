# Configuration Files

This directory contains organized configuration files for the DB-acro-website project.

## Structure

The config folder is organized as follows:

```
/config
├── biome/            # Biome formatting and linting config
├── eslint/           # ESLint configuration 
├── firebase/         # Firebase hosting configuration
├── postcss/          # PostCSS configuration for CSS processing
├── prettier/         # Prettier code formatting rules
├── tailwind/         # Tailwind CSS configuration
└── vite/             # Vite build tool configuration
```

## Usage

Configuration files are stored in their respective directories but symlinked and imported from the root directory for compatibility with the various tools.

### Adding a New Configuration

1. Add your configuration file to the appropriate subdirectory
2. If needed, create a symlink in the root of the project
3. Update any package.json scripts that might reference the configuration

## Best Practices

- Keep configuration organized by tool/purpose
- Use consistent naming conventions
- Document non-obvious configuration choices with comments
- When possible, use standard configuration formats for each tool