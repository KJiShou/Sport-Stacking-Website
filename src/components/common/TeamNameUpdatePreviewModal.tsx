import type {
    TeamNameUpdateCleanupChange,
    TeamNameUpdatePreview,
    TeamNameUpdateRegistrationChange,
    TeamNameUpdateRegistrationGroup,
    TeamNameUpdateTeamChange,
} from "@/services/firebase/teamNameMaintenanceService";
import {Modal, Table, Tag, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import type {ReactNode} from "react";

type TeamNameUpdatePreviewModalProps = {
    preview: TeamNameUpdatePreview | null;
    visible: boolean;
    confirmLoading: boolean;
    onCancel: () => void;
    onConfirm: () => void;
};

const {Text, Title} = Typography;

const valueOrDash = (value: string | number | null | undefined): string =>
    value === null || value === undefined || value === "" ? "—" : String(value);

const renderDiff = (before: string | number | null, after: string | number | null): ReactNode => (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 whitespace-normal break-words align-middle">
        <span className="min-w-0 max-w-full rounded bg-red-50 px-1 text-red-700 line-through">{valueOrDash(before)}</span>
        <span aria-hidden="true">→</span>
        <span className="min-w-0 max-w-full rounded bg-green-50 px-1 font-medium text-green-700">{valueOrDash(after)}</span>
    </span>
);

const renderFieldDiff = (
    key: string,
    label: string,
    before: string | number | null,
    after: string | number | null,
): ReactNode => (
    <div key={key} className="break-words">
        <span className="font-medium">{label}: </span>
        {renderDiff(before, after)}
    </div>
);

const teamActionLabel = (change: TeamNameUpdateTeamChange): string => {
    if (change.action === "delete") return "Delete duplicate";
    if (change.action === "merge") return "Merge / update";
    return "Update";
};

const registrationActionLabel = (action: TeamNameUpdateRegistrationGroup["action"]): string => {
    if (action === "create") return "Add entry";
    if (action === "delete") return "Remove entry";
    if (action === "mixed") return "Update entries";
    return "Update entry";
};

const renderTeamChangeDetails = (record: TeamNameUpdateTeamChange): ReactNode => {
    const details: ReactNode[] = [];
    if (record.changedFields.includes("name")) {
        details.push(renderFieldDiff("name", "Name", record.currentName, record.nextName));
    }
    if (record.changedFields.includes("team_age")) {
        details.push(renderFieldDiff("team_age", "Team age", record.currentAge, record.nextAge));
    }
    const structuralFields = record.changedFields.filter(
        (field) => field !== "name" && field !== "team_age" && field !== "name_skipped_team_relay",
    );
    if (structuralFields.length > 0) {
        details.push(<div key="structure">Structure: {structuralFields.join(", ")}</div>);
    }
    if (record.action === "delete") {
        details.push(
            <div key="duplicate">
                Delete <span className="font-medium text-red-700">{record.teamName}</span>; keep{" "}
                <span className="font-medium text-green-700">{record.keptTeamName ?? "the canonical team"}</span>
            </div>,
        );
    }
    if (record.changedFields.includes("name_skipped_team_relay")) {
        details.push(<div key="relay">Relay name excluded (not written)</div>);
    }
    return <div className="flex flex-col gap-1">{details.length > 0 ? details : <span>No field change</span>}</div>;
};

const renderRegistrationChangeDetails = (record: TeamNameUpdateRegistrationChange): ReactNode => {
    const details: ReactNode[] = [];
    if (record.changedFields.includes("name")) {
        details.push(renderFieldDiff("name", "Name", record.currentName, record.nextName));
    }
    if (record.changedFields.includes("label")) {
        details.push(renderFieldDiff("label", "Label", record.currentLabel, record.nextLabel));
    }
    const structuralFields = record.changedFields.filter((field) => field !== "name" && field !== "label");
    if (structuralFields.length > 0) details.push(<div key="other">Other: {structuralFields.join(", ")}</div>);
    if (record.action === "create") details.unshift(<div key="create">Add entry</div>);
    if (record.action === "delete") details.unshift(<div key="delete">Remove entry</div>);
    return <div className="flex flex-col gap-1">{details.length > 0 ? details : <span>No field change</span>}</div>;
};

const teamColumns: TableColumnProps<TeamNameUpdateTeamChange>[] = [
    {title: "Team", dataIndex: "teamName", width: 220},
    {title: "Event", dataIndex: "event", width: 170},
    {
        title: "Action",
        width: 130,
        render: (_, record) => (
            <Tag color={record.action === "delete" ? "red" : record.isTeamRelay ? "orange" : "arcoblue"}>
                {teamActionLabel(record)}
            </Tag>
        ),
    },
    {
        title: "Changes",
        width: 500,
        render: (_, record) => <Text>{renderTeamChangeDetails(record)}</Text>,
    },
];

const registrationGroupColumns: TableColumnProps<TeamNameUpdateRegistrationGroup>[] = [
    {title: "Team", dataIndex: "teamName", width: 200},
    {title: "Event", dataIndex: "event", width: 145},
    {
        title: "Action",
        width: 120,
        render: (_, record) => (
            <Tag color={record.action === "delete" ? "red" : record.action === "mixed" ? "orange" : "arcoblue"}>
                {registrationActionLabel(record.action)}
            </Tag>
        ),
    },
    {title: "Registration files", dataIndex: "registrationCount", width: 90},
    {
        title: "Changed fields",
        width: 120,
        render: (_, record) => (
            <div className="flex flex-wrap gap-1">
                {record.changedFields.map((field) => (
                    <Tag key={field}>{field}</Tag>
                ))}
            </div>
        ),
    },
    {
        title: "Changes",
        width: 400,
        render: (_, record) => {
            const details: ReactNode[] = [];
            if (record.changedFields.includes("name")) {
                details.push(renderFieldDiff("name", "Name", record.currentName, record.nextName));
            }
            if (record.changedFields.includes("label")) {
                details.push(renderFieldDiff("label", "Label", record.currentLabel, record.nextLabel));
            }
            const structuralFields = record.changedFields.filter((field) => field !== "name" && field !== "label");
            if (structuralFields.length > 0) details.push(<div key="other">Other: {structuralFields.join(", ")}</div>);
            return <div className="flex flex-col gap-1">{details.length > 0 ? details : <span>No field change</span>}</div>;
        },
    },
];

const registrationDetailColumns: TableColumnProps<TeamNameUpdateRegistrationChange>[] = [
    {title: "Registration document", dataIndex: "registrationId", width: 190},
    {
        title: "Participant",
        width: 180,
        render: (_, record) => `${record.userName || "—"} (${record.userGlobalId || "—"})`,
    },
    {title: "Action", width: 100, render: (_, record) => <Tag>{record.action}</Tag>},
    {
        title: "Changes",
        width: 480,
        render: (_, record) => <Text>{renderRegistrationChangeDetails(record)}</Text>,
    },
];

const cleanupColumns: TableColumnProps<TeamNameUpdateCleanupChange>[] = [
    {title: "Collection", dataIndex: "collection", width: 220},
    {title: "Document", dataIndex: "documentId", width: 300},
    {title: "Duplicate team", dataIndex: "teamName", width: 250},
    {title: "Kept team", dataIndex: "keptTeamName", width: 250, render: (value) => value || "—"},
    {title: "Action", width: 130, render: () => <Tag color="red">Delete</Tag>},
];

export default function TeamNameUpdatePreviewModal({
    preview,
    visible,
    confirmLoading,
    onCancel,
    onConfirm,
}: TeamNameUpdatePreviewModalProps) {
    if (!preview) return null;

    const {summary} = preview;
    const hasDestructiveChanges = summary.duplicateTeams > 0 || summary.cleanupDocuments > 0;
    return (
        <Modal
            visible={visible}
            title="Confirm Team Updates"
            onCancel={onCancel}
            onOk={onConfirm}
            confirmLoading={confirmLoading}
            okText={hasDestructiveChanges ? "Confirm Updates & Cleanup" : "Confirm Updates"}
            cancelText="Cancel"
            okButtonProps={hasDestructiveChanges ? {status: "danger"} : {type: "primary"}}
            maskClosable={false}
            style={{width: "min(1180px, calc(100vw - 32px))"}}
        >
            <div className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto pr-1">
                <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                    <div className="font-semibold">The following changes will be applied after confirmation.</div>
                    <div className="mt-1 text-xs text-blue-800">
                        Red with a strikethrough is the current value; green is the value that will be written. Unchanged fields
                        are omitted.
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
                        <span>Team names: {summary.teamNameUpdates}</span>
                        <span>Team ages: {summary.teamAgeUpdates}</span>
                        <span>Registration files: {summary.registrationDocuments}</span>
                        <span>Duplicate teams: {summary.duplicateTeams}</span>
                        <span>Registration teams: {preview.registrationGroups.length}</span>
                        <span>Cleanup files: {summary.cleanupDocuments}</span>
                        <span>Relay names excluded (not written): {summary.skippedTeamRelayNames}</span>
                    </div>
                </div>

                <section>
                    <Title heading={6}>Team changes ({preview.teamChanges.length})</Title>
                    <Table
                        rowKey={(record) => `${record.action}-${record.teamId}`}
                        columns={teamColumns}
                        data={preview.teamChanges}
                        pagination={{pageSize: 10, showTotal: true}}
                        scroll={{x: 1_020}}
                        size="small"
                    />
                </section>

                <section>
                    <Title heading={6}>
                        Registration changes ({preview.registrationGroups.length} teams / {summary.registrationDocuments} files)
                    </Title>
                    {preview.registrationGroups.length > 0 ? (
                        <Table
                            rowKey={(record) => `${record.teamId}-${record.action}`}
                            columns={registrationGroupColumns}
                            data={preview.registrationGroups}
                            expandedRowRender={(record) => (
                                <Table
                                    rowKey={(detail) => `${detail.registrationId}-${detail.action}`}
                                    columns={registrationDetailColumns}
                                    data={record.changes}
                                    pagination={{pageSize: 10, showTotal: true}}
                                    scroll={{x: 1_200}}
                                    size="small"
                                />
                            )}
                            pagination={{pageSize: 10, showTotal: true}}
                            scroll={{x: 1_075}}
                            size="small"
                        />
                    ) : (
                        <Text type="secondary">No registration copies require changes.</Text>
                    )}
                </section>

                <section>
                    <Title heading={6}>Cleanup documents ({preview.cleanupChanges.length})</Title>
                    {preview.cleanupChanges.length > 0 ? (
                        <Table
                            rowKey={(record) => `${record.collection}-${record.documentId}`}
                            columns={cleanupColumns}
                            data={preview.cleanupChanges}
                            pagination={{pageSize: 10, showTotal: true}}
                            scroll={{x: 1_200}}
                            size="small"
                        />
                    ) : (
                        <Text type="secondary">No verification request or team recruitment cleanup.</Text>
                    )}
                </section>
            </div>
        </Modal>
    );
}
