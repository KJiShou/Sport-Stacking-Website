import {Tabs} from "@arco-design/web-react";
import AdminPermissionsPage from "./AdminPermission";
import ProfileManagementPage from "./ProfileManagement";
import UserManagementPage from "./UserManagement";

const {TabPane} = Tabs;

export default function AdminDashboardPage() {
    return (
        <div className="w-full">
            <Tabs defaultActiveTab="permissions">
                <TabPane key="permissions" title="Permissions">
                    <AdminPermissionsPage />
                </TabPane>
                <TabPane key="users" title="User Management">
                    <UserManagementPage />
                </TabPane>
                <TabPane key="profiles" title="Profile Management">
                    <ProfileManagementPage />
                </TabPane>
            </Tabs>
        </div>
    );
}
