
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body 
        className="antialiased" 
        suppressHydrationWarning
      >

        {children}
      </body>
    </html>
  );
} 

