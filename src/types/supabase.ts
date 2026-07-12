export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[];

export type Database = {
    public: {
        Tables: {
            attachments: {
                Row: {
                    created_at: string;
                    file_type: Database['public']['Enums']['attachment_file_type'];
                    id: string;
                    name: string;
                    size: number | null;
                    storage_path: string;
                    task_id: string;
                    url: string;
                };
                Insert: {
                    created_at?: string;
                    file_type: Database['public']['Enums']['attachment_file_type'];
                    id?: string;
                    name: string;
                    size?: number | null;
                    storage_path: string;
                    task_id: string;
                    url: string;
                };
                Update: {
                    created_at?: string;
                    file_type?: Database['public']['Enums']['attachment_file_type'];
                    id?: string;
                    name?: string;
                    size?: number | null;
                    storage_path?: string;
                    task_id?: string;
                    url?: string;
                };
                Relationships: [];
            };
            goals: {
                Row: {
                    ai_analysis: Json | null;
                    assigned_month: string | null;
                    assigned_week: string | null;
                    assigned_year: string;
                    created_at: string;
                    description: string | null;
                    id: string;
                    parent_goal_id: string | null;
                    priority: number;
                    progress: number;
                    project_id: string | null;
                    reflection: string | null;
                    status: Database['public']['Enums']['goal_status'];
                    tags: string[];
                    title: string;
                    type: Database['public']['Enums']['goal_type'];
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    ai_analysis?: Json | null;
                    assigned_month?: string | null;
                    assigned_week?: string | null;
                    assigned_year: string;
                    created_at?: string;
                    description?: string | null;
                    id?: string;
                    parent_goal_id?: string | null;
                    priority: number;
                    progress?: number;
                    project_id?: string | null;
                    reflection?: string | null;
                    status?: Database['public']['Enums']['goal_status'];
                    tags?: string[];
                    title: string;
                    type: Database['public']['Enums']['goal_type'];
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    ai_analysis?: Json | null;
                    assigned_month?: string | null;
                    assigned_week?: string | null;
                    assigned_year?: string;
                    created_at?: string;
                    description?: string | null;
                    id?: string;
                    parent_goal_id?: string | null;
                    priority?: number;
                    progress?: number;
                    project_id?: string | null;
                    reflection?: string | null;
                    status?: Database['public']['Enums']['goal_status'];
                    tags?: string[];
                    title?: string;
                    type?: Database['public']['Enums']['goal_type'];
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [];
            };
            invitations: {
                Row: {
                    created_at: string;
                    email: string | null;
                    expires_at: string;
                    id: string;
                    inviter_id: string;
                    is_reusable: boolean;
                    project_id: string;
                    role: Database['public']['Enums']['hub_role'];
                    status: Database['public']['Enums']['invitation_status'];
                };
                Insert: {
                    created_at?: string;
                    email?: string | null;
                    expires_at: string;
                    id?: string;
                    inviter_id: string;
                    is_reusable?: boolean;
                    project_id: string;
                    role: Database['public']['Enums']['hub_role'];
                    status?: Database['public']['Enums']['invitation_status'];
                };
                Update: {
                    created_at?: string;
                    email?: string | null;
                    expires_at?: string;
                    id?: string;
                    inviter_id?: string;
                    is_reusable?: boolean;
                    project_id?: string;
                    role?: Database['public']['Enums']['hub_role'];
                    status?: Database['public']['Enums']['invitation_status'];
                };
                Relationships: [];
            };
            notes: {
                Row: {
                    content: string;
                    id: string;
                    period_key: string;
                    type: Database['public']['Enums']['note_type'];
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    content?: string;
                    id?: string;
                    period_key: string;
                    type: Database['public']['Enums']['note_type'];
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    content?: string;
                    id?: string;
                    period_key?: string;
                    type?: Database['public']['Enums']['note_type'];
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [];
            };
            profiles: {
                Row: {
                    avatar_url: string | null;
                    created_at: string;
                    display_name: string | null;
                    email: string;
                    id: string;
                    updated_at: string;
                };
                Insert: {
                    avatar_url?: string | null;
                    created_at?: string;
                    display_name?: string | null;
                    email: string;
                    id: string;
                    updated_at?: string;
                };
                Update: {
                    avatar_url?: string | null;
                    created_at?: string;
                    display_name?: string | null;
                    email?: string;
                    id?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            project_members: {
                Row: {
                    created_at: string;
                    project_id: string;
                    role: Database['public']['Enums']['hub_role'];
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    project_id: string;
                    role?: Database['public']['Enums']['hub_role'];
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    project_id?: string;
                    role?: Database['public']['Enums']['hub_role'];
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'project_members_project_id_fkey';
                        columns: ['project_id'];
                        isOneToOne: false;
                        referencedRelation: 'projects';
                        referencedColumns: ['id'];
                    },
                ];
            };
            projects: {
                Row: {
                    created_at: string;
                    description: string;
                    id: string;
                    owner_id: string;
                    status: Database['public']['Enums']['project_status'];
                    title: string;
                    updated_at: string;
                };
                Insert: {
                    created_at?: string;
                    description?: string;
                    id?: string;
                    owner_id: string;
                    status?: Database['public']['Enums']['project_status'];
                    title: string;
                    updated_at?: string;
                };
                Update: {
                    created_at?: string;
                    description?: string;
                    id?: string;
                    owner_id?: string;
                    status?: Database['public']['Enums']['project_status'];
                    title?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            routines: {
                Row: {
                    active: boolean;
                    created_at: string;
                    days_of_week: number[] | null;
                    estimated_minutes: number;
                    frequency: Database['public']['Enums']['routine_frequency'];
                    id: string;
                    interval: number | null;
                    memo: string | null;
                    next_run: string;
                    project_id: string | null;
                    section_id: string | null;
                    start_date: string;
                    start_time: string | null;
                    tags: string[];
                    title: string;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    active?: boolean;
                    created_at?: string;
                    days_of_week?: number[] | null;
                    estimated_minutes?: number;
                    frequency: Database['public']['Enums']['routine_frequency'];
                    id?: string;
                    interval?: number | null;
                    memo?: string | null;
                    next_run: string;
                    project_id?: string | null;
                    section_id?: string | null;
                    start_date: string;
                    start_time?: string | null;
                    tags?: string[];
                    title: string;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    active?: boolean;
                    created_at?: string;
                    days_of_week?: number[] | null;
                    estimated_minutes?: number;
                    frequency?: Database['public']['Enums']['routine_frequency'];
                    id?: string;
                    interval?: number | null;
                    memo?: string | null;
                    next_run?: string;
                    project_id?: string | null;
                    section_id?: string | null;
                    start_date?: string;
                    start_time?: string | null;
                    tags?: string[];
                    title?: string;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [];
            };
            sections: {
                Row: {
                    end_time: string | null;
                    id: string;
                    name: string;
                    order: number;
                    start_time: string | null;
                    user_id: string;
                };
                Insert: {
                    end_time?: string | null;
                    id?: string;
                    name: string;
                    order?: number;
                    start_time?: string | null;
                    user_id: string;
                };
                Update: {
                    end_time?: string | null;
                    id?: string;
                    name?: string;
                    order?: number;
                    start_time?: string | null;
                    user_id?: string;
                };
                Relationships: [];
            };
            subscriptions: {
                Row: {
                    created_at: string;
                    current_period_end: string | null;
                    id: string;
                    plan: Database['public']['Enums']['subscription_plan'];
                    status: Database['public']['Enums']['subscription_status'];
                    stripe_customer_id: string | null;
                    stripe_subscription_id: string | null;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    current_period_end?: string | null;
                    id?: string;
                    plan?: Database['public']['Enums']['subscription_plan'];
                    status?: Database['public']['Enums']['subscription_status'];
                    stripe_customer_id?: string | null;
                    stripe_subscription_id?: string | null;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    current_period_end?: string | null;
                    id?: string;
                    plan?: Database['public']['Enums']['subscription_plan'];
                    status?: Database['public']['Enums']['subscription_status'];
                    stripe_customer_id?: string | null;
                    stripe_subscription_id?: string | null;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [];
            };
            task_comments: {
                Row: {
                    author_name: string | null;
                    author_type: Database['public']['Enums']['task_author_type'];
                    content: string;
                    created_at: string;
                    id: string;
                    task_id: string;
                    updated_at: string;
                    user_id: string | null;
                };
                Insert: {
                    author_name?: string | null;
                    author_type: Database['public']['Enums']['task_author_type'];
                    content: string;
                    created_at?: string;
                    id?: string;
                    task_id: string;
                    updated_at?: string;
                    user_id?: string | null;
                };
                Update: {
                    author_name?: string | null;
                    author_type?: Database['public']['Enums']['task_author_type'];
                    content?: string;
                    created_at?: string;
                    id?: string;
                    task_id?: string;
                    updated_at?: string;
                    user_id?: string | null;
                };
                Relationships: [];
            };
            task_tags: {
                Row: {
                    tag_id: string;
                    task_id: string;
                };
                Insert: {
                    tag_id: string;
                    task_id: string;
                };
                Update: {
                    tag_id?: string;
                    task_id?: string;
                };
                Relationships: [];
            };
            tasks: {
                Row: {
                    actual_minutes: number;
                    ai_completed_at: string | null;
                    ai_error: string | null;
                    ai_status: Database['public']['Enums']['task_ai_status'] | null;
                    ai_tags: string[];
                    assigned_date: string | null;
                    assigned_month: string | null;
                    assigned_week: string | null;
                    assigned_year: string | null;
                    assignee_id: string | null;
                    comment_count: number;
                    completed_at: string | null;
                    created_at: string;
                    date: string | null;
                    estimated_minutes: number;
                    external_link: string | null;
                    id: string;
                    memo: string | null;
                    milestone_id: string | null;
                    order: number;
                    parent_goal_id: string | null;
                    project_id: string | null;
                    reporter_id: string | null;
                    routine_id: string | null;
                    scheduled_start: string | null;
                    score: number | null;
                    section_id: string | null;
                    started_at: string | null;
                    status: Database['public']['Enums']['task_status'];
                    title: string;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    actual_minutes?: number;
                    ai_completed_at?: string | null;
                    ai_error?: string | null;
                    ai_status?: Database['public']['Enums']['task_ai_status'] | null;
                    ai_tags?: string[];
                    assigned_date?: string | null;
                    assigned_month?: string | null;
                    assigned_week?: string | null;
                    assigned_year?: string | null;
                    assignee_id?: string | null;
                    comment_count?: number;
                    completed_at?: string | null;
                    created_at?: string;
                    date?: string | null;
                    estimated_minutes?: number;
                    external_link?: string | null;
                    id?: string;
                    memo?: string | null;
                    milestone_id?: string | null;
                    order?: number;
                    parent_goal_id?: string | null;
                    project_id?: string | null;
                    reporter_id?: string | null;
                    routine_id?: string | null;
                    scheduled_start?: string | null;
                    score?: number | null;
                    section_id?: string | null;
                    started_at?: string | null;
                    status?: Database['public']['Enums']['task_status'];
                    title: string;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    actual_minutes?: number;
                    ai_completed_at?: string | null;
                    ai_error?: string | null;
                    ai_status?: Database['public']['Enums']['task_ai_status'] | null;
                    ai_tags?: string[];
                    assigned_date?: string | null;
                    assigned_month?: string | null;
                    assigned_week?: string | null;
                    assigned_year?: string | null;
                    assignee_id?: string | null;
                    comment_count?: number;
                    completed_at?: string | null;
                    created_at?: string;
                    date?: string | null;
                    estimated_minutes?: number;
                    external_link?: string | null;
                    id?: string;
                    memo?: string | null;
                    milestone_id?: string | null;
                    order?: number;
                    parent_goal_id?: string | null;
                    project_id?: string | null;
                    reporter_id?: string | null;
                    routine_id?: string | null;
                    scheduled_start?: string | null;
                    score?: number | null;
                    section_id?: string | null;
                    started_at?: string | null;
                    status?: Database['public']['Enums']['task_status'];
                    title?: string;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [];
            };
            tags: {
                Row: {
                    color: string | null;
                    created_at: string;
                    id: string;
                    memo: string | null;
                    name: string;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    color?: string | null;
                    created_at?: string;
                    id?: string;
                    memo?: string | null;
                    name: string;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    color?: string | null;
                    created_at?: string;
                    id?: string;
                    memo?: string | null;
                    name?: string;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [];
            };
            usage_monthly: {
                Row: {
                    ai_messages_count: number;
                    ai_messages_limit: number;
                    month: string;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    ai_messages_count?: number;
                    ai_messages_limit?: number;
                    month: string;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    ai_messages_count?: number;
                    ai_messages_limit?: number;
                    month?: string;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [];
            };
        };
        Views: Record<string, never>;
        Functions: {
            accept_invitation: {
                Args: {
                    invite_token: string;
                };
                Returns: string;
            };
            can_access_project: {
                Args: {
                    project_uuid: string;
                };
                Returns: boolean;
            };
            can_access_task: {
                Args: {
                    task_uuid: string;
                };
                Returns: boolean;
            };
            can_manage_project: {
                Args: {
                    project_uuid: string;
                };
                Returns: boolean;
            };
            set_updated_at: {
                Args: Record<PropertyKey, never>;
                Returns: unknown;
            };
        };
        Enums: {
            attachment_file_type: 'image' | 'file';
            goal_status: 'pending' | 'in_progress' | 'achieved' | 'missed' | 'cancelled';
            goal_type: 'yearly' | 'monthly' | 'weekly';
            hub_role: 'owner' | 'admin' | 'member' | 'viewer';
            invitation_status: 'pending' | 'accepted' | 'expired';
            note_type: 'daily' | 'weekly' | 'monthly' | 'yearly';
            project_status: 'active' | 'completed' | 'archived';
            routine_frequency: 'daily' | 'weekly' | 'monthly' | 'custom';
            subscription_plan: 'free' | 'pro' | 'business';
            subscription_status: 'active' | 'past_due' | 'canceled' | 'none';
            task_ai_status: 'pending' | 'processing' | 'completed' | 'error';
            task_author_type: 'user' | 'ai';
            task_status: 'open' | 'in_progress' | 'done' | 'skipped';
        };
        CompositeTypes: Record<string, never>;
    };
};
