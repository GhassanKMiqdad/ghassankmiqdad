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
          task_id: string | null;
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
          task_id?: string | null;
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
          task_id?: string | null;
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
            foreignKeyName: "documents_task_fkey";
            columns: ["task_id", "project_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id", "project_id"];
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey";
            columns: ["uploaded_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          actor_id: string | null;
          actor_name: string | null;
          created_at: string;
          data: NonNullable<Json>;
          id: string;
          project_id: string | null;
          read_at: string | null;
          task_id: string | null;
          type: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          project_id?: string | null;
          read_at?: string | null;
          task_id?: string | null;
          type: string;
          user_id: string;
        };
        Update: {
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          project_id?: string | null;
          read_at?: string | null;
          task_id?: string | null;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_task_id_fkey";
            columns: ["task_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
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
          is_director: boolean;
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
          is_director?: boolean;
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
          is_director?: boolean;
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
          team_id: string | null;
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
          team_id?: string | null;
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
          team_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_team_id_fkey";
            columns: ["team_id"];
            referencedRelation: "teams";
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
      task_dependencies: {
        Row: {
          created_at: string;
          created_by: string | null;
          depends_on_task_id: string;
          project_id: string;
          task_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          depends_on_task_id: string;
          project_id: string;
          task_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          depends_on_task_id?: string;
          project_id?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_dependencies_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_dependencies_predecessor_fkey";
            columns: ["depends_on_task_id", "project_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id", "project_id"];
          },
          {
            foreignKeyName: "task_dependencies_task_fkey";
            columns: ["task_id", "project_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id", "project_id"];
          },
        ];
      };
      task_publications: {
        Row: {
          completed_at: string;
          deliverable_links: string[];
          document_ids: string[];
          final_result: string;
          final_submission_version: number;
          project_id: string;
          published_at: string;
          published_by: string | null;
          responsible_id: string | null;
          responsible_name: string | null;
          responsible_title: string | null;
          task_code: string;
          task_id: string;
          team_comment: string;
          team_id: string | null;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          completed_at: string;
          deliverable_links?: string[];
          document_ids?: string[];
          final_result: string;
          final_submission_version: number;
          project_id: string;
          published_at?: string;
          published_by?: string | null;
          responsible_id?: string | null;
          responsible_name?: string | null;
          responsible_title?: string | null;
          task_code: string;
          task_id: string;
          team_comment?: string;
          team_id?: string | null;
          title: string;
        };
        Update: {
          completed_at?: string;
          deliverable_links?: string[];
          document_ids?: string[];
          final_result?: string;
          final_submission_version?: number;
          project_id?: string;
          published_at?: string;
          published_by?: string | null;
          responsible_id?: string | null;
          responsible_name?: string | null;
          responsible_title?: string | null;
          task_code?: string;
          task_id?: string;
          team_comment?: string;
          team_id?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_publications_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_publications_published_by_fkey";
            columns: ["published_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_publications_responsible_id_fkey";
            columns: ["responsible_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_publications_task_fkey";
            columns: ["task_id", "project_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id", "project_id"];
          },
          {
            foreignKeyName: "task_publications_team_id_fkey";
            columns: ["team_id"];
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      task_reviews: {
        Row: {
          additional_instructions: string;
          comment: string;
          created_at: string;
          decision: Database["public"]["Enums"]["review_decision"];
          id: string;
          new_due_at: string | null;
          previous_due_at: string | null;
          project_id: string;
          required_changes: string;
          reviewer_id: string | null;
          submission_id: string;
          task_id: string;
        };
        ComputedFields: never;
        Insert: {
          additional_instructions?: string;
          comment?: string;
          created_at?: string;
          decision: Database["public"]["Enums"]["review_decision"];
          id?: string;
          new_due_at?: string | null;
          previous_due_at?: string | null;
          project_id: string;
          required_changes?: string;
          reviewer_id?: string | null;
          submission_id: string;
          task_id: string;
        };
        Update: {
          additional_instructions?: string;
          comment?: string;
          created_at?: string;
          decision?: Database["public"]["Enums"]["review_decision"];
          id?: string;
          new_due_at?: string | null;
          previous_due_at?: string | null;
          project_id?: string;
          required_changes?: string;
          reviewer_id?: string | null;
          submission_id?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_reviews_reviewer_id_fkey";
            columns: ["reviewer_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_reviews_submission_id_fkey";
            columns: ["submission_id"];
            referencedRelation: "task_submissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_reviews_task_fkey";
            columns: ["task_id", "project_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id", "project_id"];
          },
        ];
      };
      task_submissions: {
        Row: {
          deliverable_links: string[];
          document_ids: string[];
          id: string;
          is_final: boolean;
          notes: string;
          project_id: string;
          status: Database["public"]["Enums"]["submission_status"];
          submitted_at: string;
          submitted_by: string | null;
          summary: string;
          task_id: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          deliverable_links?: string[];
          document_ids?: string[];
          id?: string;
          is_final?: boolean;
          notes?: string;
          project_id: string;
          status?: Database["public"]["Enums"]["submission_status"];
          submitted_at?: string;
          submitted_by?: string | null;
          summary: string;
          task_id: string;
          version: number;
        };
        Update: {
          deliverable_links?: string[];
          document_ids?: string[];
          id?: string;
          is_final?: boolean;
          notes?: string;
          project_id?: string;
          status?: Database["public"]["Enums"]["submission_status"];
          submitted_at?: string;
          submitted_by?: string | null;
          summary?: string;
          task_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "task_submissions_submitted_by_fkey";
            columns: ["submitted_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_submissions_task_fkey";
            columns: ["task_id", "project_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id", "project_id"];
          },
        ];
      };
      tasks: {
        Row: {
          actual_start_at: string | null;
          approved_at: string | null;
          assigned_at: string | null;
          assigned_to: string | null;
          completed_at: string | null;
          completion_criteria: string;
          created_at: string;
          created_by: string | null;
          description: string;
          due_at: string | null;
          due_at_overridden: boolean;
          duration_unit: Database["public"]["Enums"]["duration_unit"] | null;
          expected_output: string;
          id: string;
          original_instructions: string;
          planned_duration: number | null;
          planned_duration_minutes: number | null;
          planned_start_at: string | null;
          planning_month: number;
          planning_week: number | null;
          priority: Database["public"]["Enums"]["task_priority"];
          progress: number;
          project_id: string;
          published_at: string | null;
          responsible_member_id: string | null;
          status: Database["public"]["Enums"]["task_status"];
          submitted_at: string | null;
          task_code: string;
          team_id: string | null;
          title: string;
          updated_at: string;
          visibility: Database["public"]["Enums"]["task_visibility"];
          work_notes: string;
          is_blocked: boolean | null;
          schedule_status: string | null;
        };
        ComputedFields: "is_blocked" | "schedule_status";
        Insert: {
          actual_start_at?: string | null;
          approved_at?: string | null;
          assigned_at?: string | null;
          assigned_to?: string | null;
          completed_at?: string | null;
          completion_criteria?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          due_at?: string | null;
          due_at_overridden?: boolean;
          duration_unit?: Database["public"]["Enums"]["duration_unit"] | null;
          expected_output?: string;
          id?: string;
          original_instructions?: string;
          planned_duration?: number | null;
          planned_duration_minutes?: number | null;
          planned_start_at?: string | null;
          planning_month?: number;
          planning_week?: number | null;
          priority?: Database["public"]["Enums"]["task_priority"];
          progress?: number;
          project_id: string;
          published_at?: string | null;
          responsible_member_id?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          submitted_at?: string | null;
          task_code?: string;
          team_id?: string | null;
          title: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["task_visibility"];
          work_notes?: string;
        };
        Update: {
          actual_start_at?: string | null;
          approved_at?: string | null;
          assigned_at?: string | null;
          assigned_to?: string | null;
          completed_at?: string | null;
          completion_criteria?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          due_at?: string | null;
          due_at_overridden?: boolean;
          duration_unit?: Database["public"]["Enums"]["duration_unit"] | null;
          expected_output?: string;
          id?: string;
          original_instructions?: string;
          planned_duration?: number | null;
          planned_duration_minutes?: number | null;
          planned_start_at?: string | null;
          planning_month?: number;
          planning_week?: number | null;
          priority?: Database["public"]["Enums"]["task_priority"];
          progress?: number;
          project_id?: string;
          published_at?: string | null;
          responsible_member_id?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          submitted_at?: string | null;
          task_code?: string;
          team_id?: string | null;
          title?: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["task_visibility"];
          work_notes?: string;
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
          {
            foreignKeyName: "tasks_responsible_member_id_fkey";
            columns: ["responsible_member_id"];
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_team_id_fkey";
            columns: ["team_id"];
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      team_member_invites: {
        Row: {
          created_at: string;
          email: string;
          team_member_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          team_member_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          team_member_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_member_invites_team_member_id_fkey";
            columns: ["team_member_id"];
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      team_members: {
        Row: {
          added_by: string | null;
          created_at: string;
          display_name: string;
          id: string;
          job_title: string;
          member_code: string;
          role: Database["public"]["Enums"]["team_role"];
          status: Database["public"]["Enums"]["team_member_status"];
          team_id: string;
          updated_at: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          created_at?: string;
          display_name: string;
          id?: string;
          job_title?: string;
          member_code: string;
          role?: Database["public"]["Enums"]["team_role"];
          status?: Database["public"]["Enums"]["team_member_status"];
          team_id: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          job_title?: string;
          member_code?: string;
          role?: Database["public"]["Enums"]["team_role"];
          status?: Database["public"]["Enums"]["team_member_status"];
          team_id?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_added_by_fkey";
            columns: ["added_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_members_team_id_fkey";
            columns: ["team_id"];
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_members_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teams: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string;
          id: string;
          name: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teams_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
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
      complete_task: {
        Args: { p_task_id: string; p_team_comment?: string };
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
      create_team: {
        Args: { p_description?: string; p_name: string };
        Returns: string;
      };
      get_dashboard_stats: { Args: { p_today?: string }; Returns: Json };
      get_execution_report: {
        Args: { p_planning_month?: number; p_project_id?: string };
        Returns: {
          avg_completion_delay_hours: number;
          avg_start_delay_hours: number;
          completed: number;
          completed_on_time: number;
          in_review: number;
          name: string;
          overdue: number;
          revisions: number;
          submissions: number;
          total: number;
          user_id: string;
        }[];
      };
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
      get_team_invites: {
        Args: { p_team_id: string };
        Returns: {
          email: string;
          team_member_id: string;
        }[];
      };
      is_blocked: {
        Args: {
          p_task: Omit<
            Database["public"]["Tables"]["tasks"]["Row"],
            Database["public"]["Tables"]["tasks"]["ComputedFields"]
          >;
        };
        Returns: boolean;
      };
      link_team_member: {
        Args: { p_email: string; p_member_id: string };
        Returns: string;
      };
      record_project_export: {
        Args: { p_format: string; p_project_id: string; p_scope: string };
        Returns: undefined;
      };
      remove_project_member: {
        Args: { p_project_id: string; p_user_id: string };
        Returns: undefined;
      };
      remove_team_member: { Args: { p_member_id: string }; Returns: undefined };
      review_task: {
        Args: {
          p_additional_instructions?: string;
          p_comment?: string;
          p_decision: Database["public"]["Enums"]["review_decision"];
          p_new_due_at?: string;
          p_required_changes?: string;
          p_task_id: string;
        };
        Returns: string;
      };
      schedule_status: {
        Args: {
          p_task: Omit<
            Database["public"]["Tables"]["tasks"]["Row"],
            Database["public"]["Tables"]["tasks"]["ComputedFields"]
          >;
        };
        Returns: string;
      };
      set_member_permissions: {
        Args: {
          p_permissions: string[];
          p_project_id: string;
          p_user_id: string;
        };
        Returns: string[];
      };
      set_project_team: {
        Args: { p_project_id: string; p_team_id: string };
        Returns: undefined;
      };
      set_team_member_status: {
        Args: {
          p_member_id: string;
          p_status: Database["public"]["Enums"]["team_member_status"];
        };
        Returns: undefined;
      };
      set_user_director: {
        Args: { p_is_director: boolean; p_user_id: string };
        Returns: undefined;
      };
      start_task_review: { Args: { p_task_id: string }; Returns: undefined };
      submit_task: {
        Args: {
          p_deliverable_links?: string[];
          p_document_ids?: string[];
          p_notes?: string;
          p_summary: string;
          p_task_id: string;
        };
        Returns: string;
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
      update_team: {
        Args: { p_description: string; p_name: string; p_team_id: string };
        Returns: undefined;
      };
      upsert_team_member: {
        Args: {
          p_display_name: string;
          p_invite_email?: string;
          p_job_title: string;
          p_member_code: string;
          p_member_id: string;
          p_role: Database["public"]["Enums"]["team_role"];
          p_team_id: string;
        };
        Returns: string;
      };
    };
    Enums: {
      duration_unit: "hours" | "days" | "weeks";
      member_status: "active" | "suspended";
      project_role: "owner" | "manager" | "member" | "reviewer";
      project_status:
        "planning" | "active" | "on_hold" | "completed" | "archived";
      review_decision: "approved" | "revision_required";
      submission_status:
        "submitted" | "under_review" | "revision_required" | "approved";
      task_priority: "p0" | "p1" | "p2" | "p3";
      task_status:
        | "not_started"
        | "scheduled"
        | "in_progress"
        | "blocked"
        | "submitted"
        | "under_review"
        | "revision_required"
        | "approved"
        | "completed"
        | "cancelled";
      task_visibility: "private" | "team";
      team_member_status: "pending" | "active" | "inactive";
      team_role: "team_lead" | "team_member";
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
      duration_unit: ["hours", "days", "weeks"],
      member_status: ["active", "suspended"],
      project_role: ["owner", "manager", "member", "reviewer"],
      project_status: [
        "planning",
        "active",
        "on_hold",
        "completed",
        "archived",
      ],
      review_decision: ["approved", "revision_required"],
      submission_status: [
        "submitted",
        "under_review",
        "revision_required",
        "approved",
      ],
      task_priority: ["p0", "p1", "p2", "p3"],
      task_status: [
        "not_started",
        "scheduled",
        "in_progress",
        "blocked",
        "submitted",
        "under_review",
        "revision_required",
        "approved",
        "completed",
        "cancelled",
      ],
      task_visibility: ["private", "team"],
      team_member_status: ["pending", "active", "inactive"],
      team_role: ["team_lead", "team_member"],
    },
  },
} as const;
