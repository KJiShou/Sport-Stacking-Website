// import { useState } from 'react'
import { Button } from '@arco-design/web-react';
import '@arco-design/web-react/dist/css/arco.css';

function App() {
    return (
        <>
            <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
                <Button type="primary">Hello Arco</Button>
                <Button type="primary" onClick={() => {}}>
                    Hello Arco
                </Button>
                <h1 className="text-4xl font-bold text-blue-600">
                    Welcome to Home Page
                </h1>
                <p className="text-lg mt-4 text-gray-700">
                    This page uses Tailwind CSS!
                </p>
            </div>
        </>
    );
}

export default App;
