import * as React from 'react';

import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "@arco-design/web-react/dist/css/arco.css";
import { Navbar, Footer } from "./components/layout";
import { DeviceInspector } from "./utils/DeviceInspector";
import { Layout } from "@arco-design/web-react";
import routes from "./config/routes";

const App: React.FC = () => {
  const Content = Layout.Content;

  return (
    <Router>
      <DeviceInspector />
      <Layout className="max-h-full h-full max-w-full w-full">
        <Navbar />
        <Content className="pt-24">
          <Routes>
            {routes.map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={<route.component />}
              />
            ))}
          </Routes>
        </Content>
        <Footer />
      </Layout>
    </Router>
  );
};

export default App;
