export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_id: string | null;
          actor_name: string | null;
          created_at: string;
          entity_id: string | null;
          entity_label: string | null;
          entity_type: string;
          id: string;
          ip_address: unknown;
          metadata: NonNullable<Json>;
          new_values: Json | null;
          old_values: Json | null;
          project_id: string | null;
          user_agent: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_label?: string | null;
          entity_type: string;
          id?: string;
          ip_address?: unknown;
          metadata?: NonNullable<Json>;
          new_values?: Json | null;
          old_values?: Json | null;
          project_id?: string | null;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_label?: string | null;
          entity_type?: string;
          id?: string;
          ip_address?: unknown;
          metadata?: NonNullable<Json>;
          new_values?: Json | null;
          old_values?: Json | null;
          project_id?: string | null;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      comments: {
        Row: {
          author_id: string | null;
          content: string;
          created_at: string;
          id: string;
          project_id: string;
          task_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string | null;
          content: string;
          created_at?: string;
          id?: string;
          project_id: string;
          task_id?: string | null;
          updated_at?: string;
        };
        Update: {
          author_id?: string | null;
          content?: string;
          created_at?: string;
          id?: string;
          project_id?: string;
          task_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_task_fkey";
            columns: ["task_id", "project_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id", "project_id"];
          },
        ];
      };
      documents: {
        Row: {
          created_at: string;
          description: string;
          file_name: string;
          id: string;
          mime_type: string;
          project_id: string;
          size_bytes: number;
          storage_path: string;
          title: string;
          updated_at: string;
          uploaded_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string;
          file_name: string;
          id?: string;
          mime_type?: string;
          project_id: string;
          size_bytes?: number;
          storage_path: string;
          title: string;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string;
          file_name?: string;
          id?: string;
          mime_type?: string;
          project_id?: string;
          size_bytes?: number;
          storage_path?: string;
          title?: string;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey";
            columns: ["uploaded_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      permissions: {
        Row: {
          category: string;
          description: string;
          key: string;
          sort_order: number;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          description?: string;
          key: string;
          sort_order: number;
        };
        Update: {
          category?: string;
          description?: string;
          key?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          can_create_projects: boolean;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          is_platform_admin: boolean;
          last_sign_in_at: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          can_create_projects?: boolean;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id: string;
          is_platform_admin?: boolean;
          last_sign_in_at?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          can_create_projects?: boolean;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          is_platform_admin?: boolean;
          last_sign_in_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_members: {
        Row: {
          added_by: string | null;
          created_at: string;
          id: string;
          project_id: string;
          role: Database["public"]["Enums"]["project_role"];
          status: Database["public"]["Enums"]["member_status"];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          created_at?: string;
          id?: string;
          project_id: string;
          role?: Database["public"]["Enums"]["project_role"];
          status?: Database["public"]["Enums"]["member_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          id?: string;
          project_id?: string;
          role?: Database["public"]["Enums"]["project_role"];
          status?: Database["public"]["Enums"]["member_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_added_by_fkey";
            columns: ["added_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_members_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          created_at: string;
          created_by: string | null;
          deadline: string | null;
          description: string;
          id: string;
          name: string;
          research_goal: string;
          start_date: string | null;
          status: Database["public"]["Enums"]["project_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          deadline?: string | null;
          description?: string;
          id?: string;
          name: string;
          research_goal?: string;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          deadline?: string | null;
          description?: string;
          id?: string;
          name?: string;
          research_goal?: string;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      role_permissions: {
        Row: {
          permission_key: string;
          role: Database["public"]["Enums"]["project_role"];
        };
        ComputedFields: never;
        Insert: {
          permission_key: string;
          role: Database["public"]["Enums"]["project_role"];
        };
        Update: {
          permission_key?: string;
          role?: Database["public"]["Enums"]["project_role"];
        };
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey";
            columns: ["permission_key"];
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
        ];
      };
      tasks: {
        Row: {
          assigned_to: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          description: string;
          due_date: string | null;
          id: string;
          priority: Database["public"]["Enums"]["task_priority"];
          project_id: string;
          status: Database["public"]["Enums"]["task_status"];
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          assigned_to?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          due_date?: string | null;
          id?: string;
          priority?: Database["public"]["Enums"]["task_priority"];
          project_id: string;
          status?: Database["public"]["Enums"]["task_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          due_date?: string | null;
          id?: string;
          priority?: Database["public"]["Enums"]["task_priority"];
          project_id?: string;
          status?: Database["public"]["Enums"]["task_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey";
            columns: ["assigned_to"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_assignee_member_fkey";
            columns: ["project_id", "assigned_to"];
            referencedRelation: "project_members";
            referencedColumns: ["project_id", "user_id"];
          },
          {
            foreignKeyName: "tasks_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      user_permissions: {
        Row: {
          created_at: string;
          granted_by: string | null;
          id: string;
          permission_key: string;
          project_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          permission_key: string;
          project_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          permission_key?: string;
          project_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_permissions_granted_by_fkey";
            columns: ["granted_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_permissions_member_fkey";
            columns: ["project_id", "user_id"];
            referencedRelation: "project_members";
            referencedColumns: ["project_id", "user_id"];
          },
          {
            foreignKeyName: "user_permissions_permission_key_fkey";
            columns: ["permission_key"];
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_project_member: {
        Args: {
          p_email: string;
          p_project_id: string;
          p_role: Database["public"]["Enums"]["project_role"];
        };
        Returns: string;
      };
      admin_update_user_flags: {
        Args: {
          p_can_create_projects?: boolean;
          p_is_platform_admin?: boolean;
          p_user_id: string;
        };
        Returns: undefined;
      };
      bootstrap_platform_admin: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      create_project: {
        Args: {
          p_deadline?: string;
          p_description?: string;
          p_name: string;
          p_research_goal?: string;
          p_start_date?: string;
          p_status?: Database["public"]["Enums"]["project_status"];
        };
        Returns: string;
      };
      get_dashboard_stats: { Args: { p_today?: string }; Returns: Json };
      get_my_project_access: {
        Args: { p_project_id?: string };
        Returns: {
          member_status: Database["public"]["Enums"]["member_status"];
          permissions: string[];
          project_id: string;
          project_name: string;
          project_status: Database["public"]["Enums"]["project_status"];
          role: Database["public"]["Enums"]["project_role"];
        }[];
      };
      get_project_team: {
        Args: { p_project_id: string };
        Returns: {
          assigned_open_tasks: number;
          assigned_total_tasks: number;
          email: string;
          full_name: string;
          joined_at: string;
          last_activity_at: string;
          last_sign_in_at: string;
          permissions: string[];
          role: Database["public"]["Enums"]["project_role"];
          status: Database["public"]["Enums"]["member_status"];
          user_id: string;
        }[];
      };
      record_project_export: {
        Args: { p_format: string; p_project_id: string; p_scope: string };
        Returns: undefined;
      };
      remove_project_member: {
        Args: { p_project_id: string; p_user_id: string };
        Returns: undefined;
      };
      set_member_permissions: {
        Args: {
          p_permissions: string[];
          p_project_id: string;
          p_user_id: string;
        };
        Returns: string[];
      };
      transfer_project_ownership: {
        Args: { p_new_owner_id: string; p_project_id: string };
        Returns: undefined;
      };
      update_project_member: {
        Args: {
          p_project_id: string;
          p_reset_permissions?: boolean;
          p_role?: Database["public"]["Enums"]["project_role"];
          p_status?: Database["public"]["Enums"]["member_status"];
          p_user_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      member_status: "active" | "suspended";
      project_role: "owner" | "manager" | "member" | "reviewer";
      project_status:
        "planning" | "active" | "on_hold" | "completed" | "archived";
      task_priority: "low" | "medium" | "high" | "critical";
      task_status: "todo" | "in_progress" | "review" | "completed" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      member_status: ["active", "suspended"],
      project_role: ["owner", "manager", "member", "reviewer"],
      project_status: [
        "planning",
        "active",
        "on_hold",
        "completed",
        "archived",
      ],
      task_priority: ["low", "medium", "high", "critical"],
      task_status: ["todo", "in_progress", "review", "completed", "rejected"],
    },
  },
} as const;
