# TypeScript Guide

This project uses TypeScript for type safety and improved developer experience. This guide provides an overview of how TypeScript is set up and used in the project.

## Getting Started

### Prerequisites

- Make sure you have Node.js and npm/yarn installed
- TypeScript is included as a project dependency

### Development Workflow

1. Use `.tsx` extension for React components
2. Use `.ts` extension for utility files, hooks, and other non-component files
3. Run type checking before committing changes with `yarn typecheck`

## Available Scripts

- `yarn dev` - Start the development server
- `yarn build` - Build the project with TypeScript compilation
- `yarn typecheck` - Run TypeScript type checking without emitting files
- `yarn ts-lint` - Run TypeScript type checking with formatted output
- `yarn validate` - Run both type checking and linting

## Project Structure

- `/src/types/` - Contains shared TypeScript interfaces and types
- `/src/schema/` - Contains Zod validation schemas with corresponding TypeScript types
- Component files use `.tsx` extension
- Utility and configuration files use `.ts` extension

## Type Definitions

### Common Types

The project defines several common types in `/src/types/index.ts`:

- `Route` - For defining application routes
- `Athlete` - For athlete data
- `Record` - For tournament records
- `MenuItem` - For navigation items
- And more...

### Component Props

For React components, we typically define props using interfaces:

```tsx
interface ButtonProps {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant?: 'primary' | 'secondary';
}

const Button: React.FC<ButtonProps> = ({
    label,
    onClick,
    disabled = false,
    variant = 'primary',
}) => {
    // Component implementation
};
```

## Best Practices

1. **Use TypeScript for all new files** - Any new files should use TypeScript (`.ts` or `.tsx` extensions)

2. **Prefer interfaces for object types** - Use interfaces for objects that can be extended, use type aliases for unions, primitives, and tuples.

3. **Use explicit return types for functions** - Especially for non-trivial functions, specify return types:

    ```typescript
    function getData(): Promise<Data[]> {
        // implementation
    }
    ```

4. **Avoid `any` type** - Use `unknown` instead of `any` when the type is not known

5. **Use React.FC for components** - For components, use the `React.FC` type:

    ```tsx
    const MyComponent: React.FC<MyComponentProps> = (props) => {
        // implementation
    };
    ```

6. **Type all state** - When using React state, always type it:

    ```tsx
    const [users, setUsers] = useState<User[]>([]);
    ```

7. **Use nullish coalescing and optional chaining** - Take advantage of modern TypeScript features:
    ```typescript
    const name = user?.profile?.name ?? 'Anonymous';
    ```

## Common TypeScript Patterns in the Project

### API Calls

```typescript
const fetchData = async (): Promise<DataType[]> => {
    try {
        const response = await api.get<DataType[]>('/endpoint');
        return response.data;
    } catch (error) {
        console.error('Error fetching data', error);
        return [];
    }
};
```

### Component Props with Children

```typescript
interface LayoutProps {
    children: React.ReactNode;
    title?: string;
}

const Layout: React.FC<LayoutProps> = ({ children, title }) => {
    // Implementation
};
```

### Event Handlers

```typescript
const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    setValue(event.target.value);
};
```

## Resources

- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [React TypeScript Cheatsheet](https://react-typescript-cheatsheet.netlify.app/)
