// Common types used throughout the application

// Route type definition
export interface Route {
  path: string;
  component: React.ComponentType;
}

// Firebase related types
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
}

// Athlete type
export interface Athlete {
  id?: string;
  name: string;
  country: string;
  age: number;
}

// Record types
export interface Record {
  id?: string;
  athleteId: string;
  time: number;
  date: string;
  competition?: string;
}

// MenuItem interface
export interface MenuItem {
  key: string;
  label: string;
}

// Navigation item
export interface NavItem {
  path: string;
  label: string;
  icon?: React.ReactNode;
  children?: NavItem[];
}