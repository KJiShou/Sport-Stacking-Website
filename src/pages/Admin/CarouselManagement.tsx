import {
    Button,
    Form,
    Grid,
    Input,
    InputNumber,
    Message,
    Modal,
    Popconfirm,
    Space,
    Switch,
    Table,
    Typography,
    Upload,
} from "@arco-design/web-react";
import type {ColumnProps} from "@arco-design/web-react/es/Table";
import {IconDelete, IconDown, IconEdit, IconPlus, IconUp} from "@arco-design/web-react/icon";
import type React from "react";
import {useEffect, useState} from "react";
import type {HomeCarouselImage} from "../../schema/HomeCarouselSchema";
import {
    addCarouselImage,
    deleteCarouselImage,
    getAllCarouselImages,
    reorderCarouselImages,
    updateCarouselImage,
} from "../../services/firebase/homeCarouselService";

const FormItem = Form.Item;
const {Title, Text} = Typography;

interface FormData {
    title: string;
    description: string;
    link: string;
    order: number;
    active: boolean;
}

export const CarouselManagement: React.FC = () => {
    const [images, setImages] = useState<HomeCarouselImage[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingImage, setEditingImage] = useState<HomeCarouselImage | null>(null);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [form] = Form.useForm<FormData>();

    useEffect(() => {
        loadImages();
    }, []);

    async function loadImages() {
        setLoading(true);
        try {
            const data = await getAllCarouselImages();
            setImages(data);
        } catch (error) {
            Message.error("Failed to load carousel images");
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    function handleAdd() {
        setEditingImage(null);
        setUploadedFile(null);
        form.resetFields();
        form.setFieldsValue({
            order: images.length > 0 ? Math.max(...images.map((img) => img.order)) + 1 : 1,
            active: true,
        });
        setModalVisible(true);
    }

    function handleEdit(image: HomeCarouselImage) {
        setEditingImage(image);
        setUploadedFile(null);
        form.setFieldsValue({
            title: image.title,
            description: image.description || "",
            link: image.link || "",
            order: image.order,
            active: image.active,
        });
        setModalVisible(true);
    }

    async function handleDelete(image: HomeCarouselImage) {
        try {
            await deleteCarouselImage(image.id, image.imageUrl);
            Message.success("Image deleted successfully");
            await loadImages();
        } catch (error) {
            Message.error("Failed to delete image");
            console.error(error);
        }
    }

    async function handleSubmit() {
        try {
            const values = await form.validate();

            if (editingImage) {
                // Update existing image
                await updateCarouselImage(editingImage.id, {
                    title: values.title,
                    description: values.description || null,
                    link: values.link || null,
                    order: values.order,
                    active: values.active,
                });
                Message.success("Image updated successfully");
            } else {
                // Add new image
                if (!uploadedFile) {
                    Message.error("Please select an image");
                    return;
                }

                await addCarouselImage(uploadedFile, values.title, values.description || null, values.link || null, values.order);
                Message.success("Image added successfully");
            }

            setModalVisible(false);
            await loadImages();
        } catch (error) {
            Message.error("Failed to save image");
            console.error(error);
        }
    }

    async function handleMoveUp(image: HomeCarouselImage, index: number) {
        if (index === 0) return;

        const newImages = [...images];
        const temp = newImages[index - 1].order;
        newImages[index - 1].order = newImages[index].order;
        newImages[index].order = temp;

        try {
            await reorderCarouselImages([
                {id: newImages[index - 1].id, order: newImages[index - 1].order},
                {id: newImages[index].id, order: newImages[index].order},
            ]);
            await loadImages();
        } catch (error) {
            Message.error("Failed to reorder images");
            console.error(error);
        }
    }

    async function handleMoveDown(image: HomeCarouselImage, index: number) {
        if (index === images.length - 1) return;

        const newImages = [...images];
        const temp = newImages[index + 1].order;
        newImages[index + 1].order = newImages[index].order;
        newImages[index].order = temp;

        try {
            await reorderCarouselImages([
                {id: newImages[index].id, order: newImages[index].order},
                {id: newImages[index + 1].id, order: newImages[index + 1].order},
            ]);
            await loadImages();
        } catch (error) {
            Message.error("Failed to reorder images");
            console.error(error);
        }
    }

    const columns: ColumnProps<HomeCarouselImage>[] = [
        {
            title: "Order",
            dataIndex: "order",
            width: 80,
            sorter: (a, b) => a.order - b.order,
        },
        {
            title: "Preview",
            dataIndex: "imageUrl",
            width: 120,
            render: (url: string) => <img src={url} alt="Preview" style={{width: "100px", height: "60px", objectFit: "cover"}} />,
        },
        {
            title: "Title",
            dataIndex: "title",
        },
        {
            title: "Description",
            dataIndex: "description",
            render: (desc: string | null) => desc || "-",
        },
        {
            title: "Link",
            dataIndex: "link",
            render: (link: string | null) =>
                link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer">
                        View
                    </a>
                ) : (
                    "-"
                ),
        },
        {
            title: "Active",
            dataIndex: "active",
            width: 80,
            render: (active: boolean, record: HomeCarouselImage) => (
                <Switch
                    checked={active}
                    onChange={async (checked) => {
                        try {
                            await updateCarouselImage(record.id, {active: checked});
                            await loadImages();
                        } catch (error) {
                            Message.error("Failed to update status");
                        }
                    }}
                />
            ),
        },
        {
            title: "Actions",
            width: 200,
            render: (_: unknown, record: HomeCarouselImage, index: number) => (
                <Space>
                    <Button size="small" icon={<IconUp />} disabled={index === 0} onClick={() => handleMoveUp(record, index)} />
                    <Button
                        size="small"
                        icon={<IconDown />}
                        disabled={index === images.length - 1}
                        onClick={() => handleMoveDown(record, index)}
                    />
                    <Button size="small" type="primary" icon={<IconEdit />} onClick={() => handleEdit(record)} />
                    <Popconfirm
                        title="Are you sure you want to delete this image?"
                        onOk={() => handleDelete(record)}
                        okButtonProps={{status: "danger"}}
                    >
                        <Button size="small" status="danger" icon={<IconDelete />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div className="flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10 w-full">
            <div className="bg-white flex flex-col w-full h-fit gap-4 p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <div className="w-full flex justify-between items-center mb-4">
                    <Title heading={3}>Carousel Management</Title>
                    <Button type="primary" icon={<IconPlus />} onClick={handleAdd}>
                        Add Image
                    </Button>
                </div>
                <div className="w-full">
                    <Table loading={loading} columns={columns} data={images} rowKey="id" pagination={{pageSize: 10}} stripe />
                </div>
            </div>

            <Modal
                title={editingImage ? "Edit Carousel Image" : "Add Carousel Image"}
                visible={modalVisible}
                onOk={handleSubmit}
                onCancel={() => setModalVisible(false)}
                style={{width: "600px"}}
            >
                <Form form={form} layout="vertical">
                    {!editingImage && (
                        <FormItem label="Image" required rules={[{required: true, message: "Please upload an image"}]}>
                            <Upload
                                accept="image/*"
                                limit={1}
                                autoUpload={false}
                                onChange={(_, currentFile) => {
                                    if (currentFile?.originFile) {
                                        setUploadedFile(currentFile.originFile as File);
                                    }
                                }}
                                onRemove={() => setUploadedFile(null)}
                            />
                        </FormItem>
                    )}

                    <FormItem label="Title" field="title" required rules={[{required: true, message: "Title is required"}]}>
                        <Input placeholder="Enter image title" />
                    </FormItem>

                    <FormItem label="Description" field="description">
                        <Input.TextArea placeholder="Enter image description (optional)" rows={3} />
                    </FormItem>

                    <FormItem label="Link" field="link">
                        <Input placeholder="Enter link URL (optional)" />
                    </FormItem>

                    <FormItem label="Order" field="order" required rules={[{required: true, message: "Order is required"}]}>
                        <InputNumber placeholder="Enter display order" min={1} />
                    </FormItem>

                    <FormItem label="Active" field="active" triggerPropName="checked">
                        <Switch />
                    </FormItem>
                </Form>
            </Modal>
        </div>
    );
};
