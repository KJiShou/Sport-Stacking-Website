// import { useState } from 'react'
//import { Button } from '@arco-design/web-react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import '@arco-design/web-react/dist/css/arco.css';
import Navbar from './components/Navbar';

const App = () => {
    return (
        <Router>
            <Navbar />
            <Routes>
                <Route path="/" element={<div />} />
            </Routes>
        </Router>
    );
};

export default App;
